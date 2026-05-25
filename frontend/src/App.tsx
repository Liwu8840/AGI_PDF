import { useEffect, useRef, useState } from 'react'
import { exportDocx, getCachedTranslations, getPageImage, listPDFs, parsePDF, translatePage, chatStream, getSettings, updateSettings, getPDFFileUrl } from './api'
import { PDFViewer } from './components/PDFViewer'
import { TranslationPanel } from './components/TranslationPanel'
import { ChatBox } from './components/ChatBox'
import { SettingsModal } from './components/SettingsModal'
import { Toast } from './components/Toast'
import type { ChatMessage, PDFData, PDFFile, Paragraph, Settings, ToastMessage } from './types'

export default function App() {
  // 状态
  const [pdfFiles, setPdfFiles] = useState<PDFFile[]>([])
  const [selectedPdfPath, setSelectedPdfPath] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfData, setPdfData] = useState<PDFData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // 翻译相关 - 按页存储：page_num → 整页翻译文本
  const [translations, setTranslations] = useState<Record<number, string>>({})
  const [translatingPages, setTranslatingPages] = useState<Set<number>>(new Set())
  const [selectedPara, setSelectedPara] = useState<Paragraph | null>(null)

  // 聊天相关
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatContext, setChatContext] = useState<Record<string, unknown> | null>(null)

  // 页面截图相关：跟踪当前查看的页码
  const [currentPage, setCurrentPage] = useState(0)
  const pageImageCache = useRef<Map<number, string>>(new Map())

  // 设置相关
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // 全文翻译
  const [translatingAll, setTranslatingAll] = useState(false)

  // Toast 通知
  const [toast, setToast] = useState<ToastMessage | null>(null)

  function showToast(text: string, type: ToastMessage['type'] = 'error') {
    setToast({ text, type })
  }

  const pdfNameRef = useRef('')
  const pdfPathRef = useRef('')
  const translatedPagesRef = useRef<Set<number>>(new Set())  // 已翻译的页码缓存

  // 查找段落所在的页码
  function findPageForParagraph(paraId: number): number {
    if (!pdfData) return 1
    for (const page of pdfData.pages) {
      if (page.paragraphs.some(p => p.id === paraId)) {
        return page.page_num
      }
    }
    return 1
  }

  // 初始化
  useEffect(() => {
    loadSettingsFromServer()
    loadPDFList()
  }, [])

  // 自动翻译当前可见页（800ms 防抖，避免滚动时频繁触发）
  useEffect(() => {
    const page = currentPage
    if (!page || !pdfPathRef.current || !pdfData) return
    if (translatedPagesRef.current.has(page)) return

    const timer = setTimeout(async () => {
      setTranslatingPages(prev => new Set([...prev, page]))
      try {
        const result = await translatePage(pdfPathRef.current, page)
        const text = Object.values(result)[0] || ''
        setTranslations(prev => ({ ...prev, [page]: text }))
        translatedPagesRef.current.add(page)
      } catch {
        setTranslations(prev => ({ ...prev, [page]: '[翻译失败]' }))
      } finally {
        setTranslatingPages(prev => {
          const next = new Set([...prev])
          next.delete(page)
          return next
        })
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [currentPage, pdfData])

  async function loadSettingsFromServer() {
    try {
      const s = await getSettings()
      setSettings(s)
    } catch {
      // 忽略设置加载失败
    }
  }

  async function loadPDFList() {
    try {
      const files = await listPDFs()
      setPdfFiles(files)
      if (files.length > 0) {
        await selectPDF(files[0].path)
      }
    } catch {
      setLoadError('无法获取 PDF 列表，请确认后端服务已启动')
    }
  }

  async function selectPDF(path: string) {
    setSelectedPdfPath(path)
    pdfPathRef.current = path
    setPdfUrl(getPDFFileUrl(path))
    setTranslations({})
    setSelectedPara(null)
    setChatMessages([])
    setChatContext(null)
    setCurrentPage(1)
    pageImageCache.current = new Map()
    translatedPagesRef.current = new Set()  // 重置已翻译缓存
    setLoadError('')

    const name = path.split('/').pop() || ''
    pdfNameRef.current = name

    setLoading(true)
    try {
      const data = await parsePDF(path)
      setPdfData(data)

      // 加载该 PDF 的历史翻译缓存
      const cached = await getCachedTranslations(path)
      if (Object.keys(cached).length > 0) {
        const parsed: Record<number, string> = {}
        const cachedPages = new Set<number>()
        for (const [key, val] of Object.entries(cached)) {
          const pageNum = Number(key)
          parsed[pageNum] = val
          cachedPages.add(pageNum)
        }
        setTranslations(parsed)
        translatedPagesRef.current = cachedPages
      }
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : '解析 PDF 失败')
    } finally {
      setLoading(false)
    }
  }

  // 点击段落 → 翻译整页
  async function handleParaClick(para: Paragraph, clientX: number, clientY: number) {
    setSelectedPara(para)

    // 更新聊天上下文
    setChatContext({
      pdf_name: pdfNameRef.current,
      selected_text: para.text.slice(0, 500),
    })

    // 找到段落所在的页码
    const pageNum = findPageForParagraph(para.id)

    // 用 ref 确保始终拿到最新路径
    const path = pdfPathRef.current
    if (!path) return

    // 如果该页还没翻译过，将整页内容转为 Markdown 并发给大模型翻译
    if (!translatedPagesRef.current.has(pageNum)) {
      setTranslatingPages(prev => new Set([...prev, pageNum]))

      try {
        const pageTranslations = await translatePage(path, pageNum)
        // 返回格式: {"page_num": "full_translation_text"}
        const fullText = Object.values(pageTranslations)[0] || ''
        setTranslations(prev => ({ ...prev, [pageNum]: fullText }))
        translatedPagesRef.current.add(pageNum)
      } catch {
        setTranslations(prev => ({ ...prev, [pageNum]: '[翻译失败]' }))
      } finally {
        setTranslatingPages(prev => {
          const next = new Set([...prev])
          next.delete(pageNum)
          return next
        })
      }
    }
  }

  // 发送聊天消息（自动附带当前页面截图）
  async function handleChatSend(messages: ChatMessage[]) {
    setChatMessages(messages)

    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role !== 'user') return

    // 获取当前页面截图（缓存中取或从后端拉取）
    let pageImage: string | null = null
    if (pdfPathRef.current && currentPage > 0) {
      if (pageImageCache.current.has(currentPage)) {
        pageImage = pageImageCache.current.get(currentPage)!
      } else {
        pageImage = await getPageImage(pdfPathRef.current, currentPage)
        if (pageImage) {
          pageImageCache.current.set(currentPage, pageImage)
        }
      }
    }

    // 添加占位 assistant 消息
    setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])

    await chatStream(
      messages,
      chatContext,
      pageImage,
      (chunk) => {
        setChatMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + chunk }
          }
          return updated
        })
      },
      () => {
        // 完成
      },
      (err) => {
        // 移除刚才添加的空占位消息
        setChatMessages(prev => prev.slice(0, -1))
        showToast(`模型响应错误: ${err}`)
      },
    )
  }

  // 重新翻译单页（失败后重试）
  async function handleRetryPage(pageNum: number) {
    const path = pdfPathRef.current
    if (!path || !pdfData) return

    setTranslatingPages(prev => new Set([...prev, pageNum]))
    try {
      const result = await translatePage(path, pageNum)
      const text = Object.values(result)[0] || ''
      setTranslations(prev => ({ ...prev, [pageNum]: text }))
      translatedPagesRef.current.add(pageNum)
    } catch {
      setTranslations(prev => ({ ...prev, [pageNum]: '[翻译失败]' }))
    } finally {
      setTranslatingPages(prev => {
        const next = new Set([...prev])
        next.delete(pageNum)
        return next
      })
    }
  }

  // 翻译全文 - 逐页调用视觉模型翻译
  async function handleTranslateAll() {
    if (!selectedPdfPath || !pdfData || translatingAll) return
    setTranslatingAll(true)

    const totalPages = pdfData.total_pages
    let hasError = false

    for (let page = 1; page <= totalPages; page++) {
      // 跳过已翻译成功的页面
      if (translatedPagesRef.current.has(page) && translations[page] && translations[page] !== '[翻译失败]') continue

      setTranslatingPages(prev => new Set([...prev, page]))
      try {
        const result = await translatePage(selectedPdfPath, page)
        const text = Object.values(result)[0] || ''
        setTranslations(prev => ({ ...prev, [page]: text }))
        translatedPagesRef.current.add(page)
      } catch (e: unknown) {
        hasError = true
        setTranslations(prev => ({ ...prev, [page]: '[翻译失败]' }))
      } finally {
        setTranslatingPages(prev => {
          const next = new Set([...prev])
          next.delete(page)
          return next
        })
      }
    }

    setTranslatingAll(false)
    if (!hasError && selectedPdfPath) {
      try {
        await exportDocx(selectedPdfPath)
        showToast('全部页面翻译完成，DOCX 已保存到 PDF 同目录', 'success')
      } catch {
        // 自动导出失败不影响翻译结果
      }
    } else if (hasError) {
      showToast('部分页面翻译失败，请检查 API 配置后重试', 'error')
    }
  }

  // 保存设置
  async function handleSaveSettings(newSettings: Settings) {
    await updateSettings(newSettings)
    setSettings(newSettings)
    setShowSettings(false)
    // 如果有 PDF 路径改变，重新加载
    if (selectedPdfPath) {
      await selectPDF(selectedPdfPath)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部工具栏 */}
      <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-800">PDF 翻译阅读器</h1>
          <select
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white max-w-xs"
            value={selectedPdfPath}
            onChange={e => selectPDF(e.target.value)}
          >
            {pdfFiles.map(f => (
              <option key={f.path} value={f.path}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {/* 文件信息 */}
          {pdfData && (
            <span className="text-xs text-gray-500">共 {pdfData.total_pages} 页</span>
          )}
          {/* 全文翻译按钮 */}
          <button
            className={`text-sm px-3 py-1 rounded transition-colors ${
              translatingAll
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
            }`}
            disabled={translatingAll}
            onClick={handleTranslateAll}
          >
            {translatingAll ? (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                翻译中...
              </span>
            ) : (
              '翻译全文'
            )}
          </button>
          {/* 导出 DOCX 按钮 */}
          <button
            className={`text-sm px-3 py-1 rounded transition-colors ${
              !pdfData || Object.keys(translations).length === 0
                ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                : 'bg-green-50 text-green-600 hover:bg-green-100'
            }`}
            disabled={!pdfData || Object.keys(translations).length === 0}
            onClick={async () => {
              if (selectedPdfPath) {
                try {
                  await exportDocx(selectedPdfPath)
                  showToast('DOCX 已保存到 PDF 同目录', 'success')
                } catch {
                  showToast('导出 DOCX 失败，请先翻译全文', 'error')
                }
              }
            }}
          >
            导出 DOCX
          </button>
          {/* API 状态指示 */}
          <span
            className={`w-2 h-2 rounded-full ${settings?.LLM_API_KEY && settings.LLM_API_KEY !== 'sk-your-key-here' ? 'bg-green-400' : 'bg-yellow-400'}`}
            title={settings?.LLM_API_KEY && settings.LLM_API_KEY !== 'sk-your-key-here' ? 'API 已配置' : 'API 未配置'}
          />
          <button
            className="text-sm text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100"
            onClick={() => setShowSettings(true)}
          >
            设置
          </button>
        </div>
      </header>

      {/* 错误提示 */}
      {loadError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-600">
          {loadError}
        </div>
      )}

      {/* 主体区域：三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：PDF 阅读器 */}
        <div className="w-1/2 border-r border-gray-200 overflow-hidden flex flex-col">
          <div className="bg-gray-100 px-3 py-1.5 text-xs text-gray-600 border-b border-gray-200 shrink-0">
            原文 PDF
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-gray-50">
            {loading ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                加载中...
              </div>
            ) : pdfData && pdfUrl ? (
              <PDFViewer
                pdfUrl={pdfUrl}
                pdfData={pdfData}
                selectedParaId={selectedPara?.id ?? null}
                translatingPages={translatingPages}
                translatedPages={new Set(Object.keys(translations).map(Number))}
                onParaClick={handleParaClick}
                onPageChange={setCurrentPage}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                请选择 PDF 文件
              </div>
            )}
          </div>
        </div>

        {/* 右侧：翻译面板 */}
        <div className="w-1/2 overflow-hidden flex flex-col">
          <div className="bg-gray-100 px-3 py-1.5 text-xs text-gray-600 border-b border-gray-200 shrink-0">
            中文翻译
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <TranslationPanel
              pdfData={pdfData}
              translations={translations}
              translatingPages={translatingPages}
              selectedParaId={selectedPara?.id ?? null}
              currentPage={currentPage}
              onParaClick={handleParaClick}
              onRetryPage={handleRetryPage}
            />
          </div>
        </div>
      </div>

      {/* 底部：聊天框 */}
      <ChatBox
        messages={chatMessages}
        onSend={handleChatSend}
      />

      {/* Toast 通知 */}
      <Toast message={toast} onClose={() => setToast(null)} />

      {/* 设置弹窗 */}
      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}