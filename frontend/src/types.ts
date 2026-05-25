/* ── 类型定义 ── */

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Paragraph {
  id: number
  text: string
  bbox: BBox
}

export interface PageData {
  page_num: number
  width: number
  height: number
  paragraphs: Paragraph[]
  images: { id: number; bbox: BBox }[]
}

export interface PDFData {
  total_pages: number
  pages: PageData[]
}

export interface PDFFile {
  name: string
  path: string
}

export interface Settings {
  PDF_PATH: string
  LLM_API_KEY: string
  LLM_BASE_URL: string
  LLM_MODEL: string
  LLM_TEMPERATURE: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ToastMessage {
  text: string
  type?: 'error' | 'success' | 'info'
}