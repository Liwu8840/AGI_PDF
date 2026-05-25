/* ── API 客户端 ── */
import type { ChatMessage, PDFData, PDFFile, Settings } from './types'

const BASE = ''  // 开发模式下 Vite proxy 处理跨域

export async function listPDFs(): Promise<PDFFile[]> {
  const res = await fetch(`${BASE}/api/pdf/list`)
  const data = await res.json()
  return data.files
}

export async function parsePDF(path: string): Promise<PDFData> {
  const res = await fetch(`${BASE}/api/pdf/parse?path=${encodeURIComponent(path)}`)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || '解析 PDF 失败')
  }
  return res.json()
}

export async function translateText(text: string): Promise<string> {
  const res = await fetch(`${BASE}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error('翻译请求失败')
  const data = await res.json()
  return data.translated_text
}

export async function getPageImage(path: string, page: number): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/pdf/page-image?path=${encodeURIComponent(path)}&page=${page}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.image || null
  } catch {
    return null
  }
}

export async function chatStream(
  messages: ChatMessage[],
  context: Record<string, unknown> | null,
  pageImage: string | null,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context, page_image: pageImage }),
    })
    if (!res.ok) throw new Error('聊天请求失败')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk(decoder.decode(value, { stream: true }))
    }
    onDone()
  } catch (e: unknown) {
    onError(e instanceof Error ? e.message : '未知错误')
  }
}

export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${BASE}/api/settings`)
  return res.json()
}

export async function updateSettings(settings: Partial<Settings>): Promise<void> {
  await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export function getPDFFileUrl(path: string): string {
  return `${BASE}/api/pdf/file?path=${encodeURIComponent(path)}`
}

export async function getCachedTranslations(path: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${BASE}/api/translations?path=${encodeURIComponent(path)}`)
    if (!res.ok) return {}
    const data = await res.json()
    return data.translations || {}
  } catch {
    return {}
  }
}

export async function translatePage(path: string, page: number): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/translate-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, page }),
  })
  if (!res.ok) throw new Error('页面翻译失败')
  const data = await res.json()
  return data.translations
}

export async function translateAll(path: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/translate-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error('批量翻译失败')
  const data = await res.json()
  return data.translations
}

export async function exportPDF(path: string, translations: Record<string, string>): Promise<void> {
  const res = await fetch(`${BASE}/api/export-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, translations }),
  })
  if (!res.ok) throw new Error('导出 PDF 失败')
  // 触发下载
  const blob = await res.blob()
  const baseName = path.split('/').pop()?.replace(/\.pdf$/i, '') || 'document'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}_翻译.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportDocx(path: string): Promise<void> {
  const res = await fetch(`${BASE}/api/export-docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error('导出 DOCX 失败')
}