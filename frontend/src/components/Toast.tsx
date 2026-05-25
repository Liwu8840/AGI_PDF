/* 全局 Toast 通知组件 */
import { useEffect, useState } from 'react'

export interface ToastMessage {
  text: string
  type?: 'error' | 'success' | 'info'
}

interface Props {
  message: ToastMessage | null
  onClose: () => void
}

export function Toast({ message, onClose }: Props) {
  const [visible, setVisible] = useState(false)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer) clearTimeout(timer)

    if (message) {
      setVisible(true)
      const t = setTimeout(() => {
        setVisible(false)
        setTimeout(onClose, 300) // 等待退出动画
      }, 4000)
      setTimer(t)
    } else {
      setVisible(false)
    }

    return () => { if (timer) clearTimeout(timer) }
  }, [message])

  if (!message) return null

  const bgColor =
    message.type === 'error' ? 'bg-red-500' :
    message.type === 'success' ? 'bg-green-500' :
    'bg-gray-700'

  const icon =
    message.type === 'error' ? '✕' :
    message.type === 'success' ? '✓' :
    'ℹ'

  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg text-white text-sm transition-all duration-300 ${bgColor} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <span className="text-base font-bold leading-none">{icon}</span>
      <span>{message.text}</span>
      <button
        className="ml-2 text-white/70 hover:text-white text-lg leading-none"
        onClick={() => { setVisible(false); setTimeout(onClose, 300) }}
      >
        &times;
      </button>
    </div>
  )
}