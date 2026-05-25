/* PDF 阅读器组件 - 渲染 PDF 页面和段落覆盖层 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { PDFData, Paragraph } from '../types'

// 配置 PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs`

interface Props {
  pdfUrl: string
  pdfData: PDFData
  selectedParaId: number | null
  translatingPages: Set<number>
  translatedPages: Set<number>
  onParaClick: (para: Paragraph, clientX: number, clientY: number) => void
  onPageChange?: (pageNum: number) => void
}

const PAGE_WIDTH = 700

export function PDFViewer({ pdfUrl, pdfData, selectedParaId, translatingPages, translatedPages, onParaClick, onPageChange }: Props) {
  const [numPages, setNumPages] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // 使用 IntersectionObserver 追踪当前可见页面
  useEffect(() => {
    if (!onPageChange) return

    const observer = new IntersectionObserver(
      (entries) => {
        let bestPage = 0
        let bestRatio = 0
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio
            bestPage = Number(entry.target.getAttribute('data-page'))
          }
        }
        if (bestPage > 0) {
          onPageChange(bestPage)
        }
      },
      { threshold: [0.1, 0.3, 0.5, 0.7, 0.9] }
    )

    const refs = pageRefs.current
    for (const key in refs) {
      const el = refs[key]
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [numPages, onPageChange])

  // 点击右侧翻译段落 → 左侧 PDF 滚动到对应页
  useEffect(() => {
    if (selectedParaId === null) return
    for (const [pageNumStr, paras] of Object.entries(pageParaMap)) {
      if (paras.some(p => p.id === selectedParaId)) {
        const el = pageRefs.current[Number(pageNumStr)]
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        break
      }
    }
  }, [selectedParaId])

  // 建立页码→页面信息索引
  const pageInfoMap = useMemo(() => {
    const map: Record<number, { width: number; height: number }> = {}
    for (const page of pdfData.pages) {
      map[page.page_num] = { width: page.width, height: page.height }
    }
    return map
  }, [pdfData])

  // 为每个页面构建段落索引
  const pageParaMap = useMemo(() => {
    const map: Record<number, Paragraph[]> = {}
    for (const page of pdfData.pages) {
      map[page.page_num] = page.paragraphs
    }
    return map
  }, [pdfData])

  function onLoadSuccess({ numPages: n }: { numPages: number }) {
    setNumPages(n)
    setLoadError(null)
  }

  function onLoadError(err: Error) {
    console.error('PDF 加载失败:', err)
    setLoadError(err.message || '未知错误')
  }

  // 将 PDF 坐标映射到渲染坐标（使用 pdfData 中的原始 PDF 尺寸）
  function mapBBox(para: Paragraph, pageNum: number) {
    const pageInfo = pageInfoMap[pageNum]
    if (!pageInfo) return null
    // pageInfo.width/height 来自 PyMuPDF（PDF 点，72 DPI）
    // PAGE_WIDTH 是渲染宽度（CSS 像素）
    // 1 PDF 点 = PAGE_WIDTH / pageInfo.width CSS 像素
    const scale = PAGE_WIDTH / pageInfo.width
    return {
      left: para.bbox.x0 * scale,
      top: para.bbox.y0 * scale,
      width: (para.bbox.x1 - para.bbox.x0) * scale,
      height: (para.bbox.y1 - para.bbox.y0) * scale,
    }
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <p className="text-red-500 font-medium mb-2">PDF 加载失败</p>
          <p className="text-sm text-gray-500">{loadError}</p>
          <p className="text-xs text-gray-400 mt-2">请确认后端服务已启动 ({pdfUrl})</p>
        </div>
      </div>
    )
  }

  return (
    <Document
      file={pdfUrl}
      onLoadSuccess={onLoadSuccess}
      onLoadError={onLoadError}
      className="flex flex-col items-center py-4 gap-4"
    >
      {Array.from({ length: numPages || pdfData.total_pages }, (_, i) => i + 1).map(pageNum => {
        const pageInfo = pageInfoMap[pageNum]
        if (!pageInfo) return null
        // 计算渲染高度以匹配 Page 组件的宽高比
        const renderedHeight = (pageInfo.height / pageInfo.width) * PAGE_WIDTH

        return (
          <div
            key={pageNum}
            ref={el => { pageRefs.current[pageNum] = el }}
            data-page={pageNum}
            className="relative shadow-md bg-white"
            style={{ width: PAGE_WIDTH, height: renderedHeight }}
          >
            {/* 翻译状态指示 */}
            <span
              className={`absolute top-1 right-1 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm ${
                translatedPages.has(pageNum)
                  ? 'bg-green-100 text-green-700'
                  : translatingPages.has(pageNum)
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100/80 text-gray-500'
              }`}
            >
              {translatedPages.has(pageNum) ? (
                <>✓ 已翻译</>
              ) : translatingPages.has(pageNum) ? (
                <><span className="inline-block w-2.5 h-2.5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />翻译中</>
              ) : (
                <>⟳ 待翻译</>
              )}
            </span>
            <Page
              pageNumber={pageNum}
              width={PAGE_WIDTH}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="block"
            />
            {/* 段落覆盖层 - 与 Page 组件完全重叠 */}
            <div className="absolute inset-0" style={{ width: PAGE_WIDTH, height: renderedHeight }}>
              {(pageParaMap[pageNum] || []).map(para => {
                const pos = mapBBox(para, pageNum)
                if (!pos) return null
                const isSelected = selectedParaId === para.id
                const isPageTranslating = translatingPages.has(pageNum)
                return (
                  <div
                    key={para.id}
                    className="paragraph-overlay absolute rounded"
                    style={{
                      left: pos.left,
                      top: pos.top,
                      width: pos.width,
                      height: pos.height,
                      backgroundColor: isSelected
                        ? 'rgba(59, 130, 246, 0.25)'
                        : isPageTranslating
                          ? 'rgba(234, 179, 8, 0.10)'
                          : 'transparent',
                      border: isSelected ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent',
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = e.currentTarget.getBoundingClientRect()
                      onParaClick(para, rect.left + rect.width / 2, rect.top - 10)
                    }}
                    title={para.text.slice(0, 100)}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </Document>
  )
}