/* 浮动翻译提示 - 点击段落后悬浮显示翻译 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  translation: string
  original: string
  position: { x: number; y: number }
  onClose: () => void
}

export function FloatingTip({ translation, original, position, onClose }: Props) {
  const [adjustedPos, setAdjustedPos] = useState(position)

  useEffect(() => {
    // 确保提示框不超出屏幕
    const w = 400  // 最大宽度
    const h = 300  // 最大高度
    let { x, y } = position

    // 如果点击位置在屏幕右侧，向左偏移
    if (x + w > window.innerWidth - 20) {
      x = window.innerWidth - w - 20
    }
    // 如果点击位置在屏幕底部，向上偏移
    if (y + h > window.innerHeight - 20) {
      y = window.innerHeight - h - 20
    }
    // 确保不超出左侧和顶部
    x = Math.max(10, x)
    y = Math.max(10, y)

    setAdjustedPos({ x, y })
  }, [position])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 5 }}
        transition={{ duration: 0.15 }}
        className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
        style={{
          left: adjustedPos.x,
          top: adjustedPos.y,
          width: 'min(400px, calc(100vw - 40px))',
          maxHeight: 'min(300px, calc(100vh - 40px))',
        }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between bg-blue-50 px-3 py-2 border-b border-blue-100">
          <span className="text-xs font-medium text-blue-700">翻译结果</span>
          <button
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* 内容 */}
        <div className="p-3 overflow-y-auto max-h-[250px]">
          <p className="text-sm text-gray-800 leading-relaxed">{translation}</p>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}