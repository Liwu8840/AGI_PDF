/* 翻译面板 - 按页显示整页翻译结果（Markdown 格式渲染） */
import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PDFData, Paragraph } from '../types'

interface Props {
  pdfData: PDFData | null
  translations: Record<number, string>
  translatingPages: Set<number>
  selectedParaId: number | null
  currentPage: number
  onParaClick: (para: Paragraph, clientX: number, clientY: number) => void
  onRetryPage?: (pageNum: number) => void
}

export function TranslationPanel({ pdfData, translations, translatingPages, selectedParaId, currentPage, onParaClick, onRetryPage }: Props) {
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const lastScrollFrom = useRef<'left' | 'right'>('left')

  function findPageForParagraph(paraId: number): number | null {
    if (!pdfData) return null
    for (const page of pdfData.pages) {
      if (page.paragraphs.some(p => p.id === paraId)) {
        return page.page_num
      }
    }
    return null
  }

  // 点击右侧段落 → 记录来源，左侧会同步滚动
  useEffect(() => {
    if (selectedParaId === null) return
    lastScrollFrom.current = 'right'
    const pageNum = findPageForParagraph(selectedParaId)
    if (pageNum === null) return
    const el = pageRefs.current[pageNum]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedParaId])

  // 左侧翻页 → 右侧自动滚动到对应页（仅当不是右侧点击触发的）
  useEffect(() => {
    if (currentPage <= 0) return
    // 如果刚才是右侧点击触发的 currentPage 变化，跳过避免冲突
    if (lastScrollFrom.current === 'right') {
      lastScrollFrom.current = 'left'
      return
    }
    const el = pageRefs.current[currentPage]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [currentPage])

  if (!pdfData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        请先加载 PDF 文档
      </div>
    )
  }

  if (pdfData.pages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        未检测到 PDF 页面
      </div>
    )
  }

  return (
    <div className="p-4 space-y-5">
      {pdfData.pages.map(page => {
        const pageNum = page.page_num
        const isSelectedPage = selectedParaId !== null && page.paragraphs.some(p => p.id === selectedParaId)
        const isTranslating = translatingPages.has(pageNum)
        const translatedText = translations[pageNum]

        return (
          <div
            key={pageNum}
            ref={el => { pageRefs.current[pageNum] = el }}
            className={`rounded-xl border-2 p-5 transition-all duration-200 ${
              isSelectedPage
                ? 'border-blue-400 bg-blue-50/40 shadow-md ring-1 ring-blue-200'
                : translatedText
                  ? 'border-gray-200 bg-white'
                  : 'border-gray-100 bg-gray-50'
            }`}
          >
            {/* 页眉 */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
              <span className="text-sm font-medium text-gray-700">
                第 {pageNum} 页
              </span>
              {isTranslating && (
                <span className="text-xs text-yellow-500 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                  翻译中...
                </span>
              )}
            </div>

            {/* 翻译内容（Markdown 渲染） */}
            <div className="min-h-[3em]">
              {isTranslating ? (
                <div className="space-y-2">
                  <div className="h-3 bg-gray-200 animate-pulse rounded w-full" />
                  <div className="h-3 bg-gray-200 animate-pulse rounded w-5/6" />
                  <div className="h-3 bg-gray-200 animate-pulse rounded w-4/6" />
                  <div className="h-3 bg-gray-200 animate-pulse rounded w-full" />
                  <div className="h-3 bg-gray-200 animate-pulse rounded w-3/6" />
                </div>
              ) : translatedText === '[翻译失败]' ? (
                  <div className="text-center py-4">
                    <p className="text-red-500 text-sm font-medium mb-2">翻译失败</p>
                    <p className="text-xs text-gray-400 mb-3">请检查 API 配置或网络连接后重试</p>
                    <button
                      className="text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-4 py-1.5 rounded transition-colors"
                      onClick={() => onRetryPage?.(pageNum)}
                    >
                      重新翻译
                    </button>
                  </div>
                ) : translatedText ? (
                <div className="prose prose-sm prose-gray max-w-none prose-headings:text-gray-800 prose-headings:font-semibold prose-p:text-gray-700 prose-p:leading-relaxed prose-strong:text-gray-800 prose-table:text-sm prose-th:bg-gray-50 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-code:text-blue-700 prose-code:bg-blue-50 prose-code:px-1 prose-code:rounded">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {translatedText}
                  </ReactMarkdown>
                </div>
              ) : (
                <div>
                  <div className="text-xs text-gray-400 mb-2">
                    {page.paragraphs.length > 0
                      ? `${page.paragraphs.length} 段文本 · `
                      : ''}
                    点击左侧原文或下方按钮翻译整页
                  </div>
                  <div className="text-xs text-gray-500 leading-relaxed line-clamp-4 mb-3">
                    {page.paragraphs.slice(0, 3).map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && <br />}
                        {p.text.slice(0, 150)}
                      </span>
                    ))}
                  </div>
                  {page.paragraphs.length > 0 && (
                    <button
                      className="text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded transition-colors border border-blue-200"
                      onClick={() => onParaClick(page.paragraphs[0], 0, 0)}
                    >
                      翻译本页
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}