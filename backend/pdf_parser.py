"""PDF 解析模块 - 提取文本段落和图片位置"""
import re
import fitz  # PyMuPDF
from typing import Any, Dict, List, Tuple


def parse_pdf(file_path: str) -> Dict[str, Any]:
    """解析 PDF，返回每一页的段落和图片信息"""
    doc = fitz.open(file_path)
    result: Dict[str, Any] = {"total_pages": len(doc), "pages": []}

    for page_num in range(len(doc)):
        page = doc[page_num]
        rect = page.rect
        page_width = rect.width
        page_height = rect.height

        # 使用 blocks 模式获取文本块（比 dict 模式更自然的段落分割）
        blocks = page.get_text("blocks")
        paragraphs: List[Dict[str, Any]] = []
        images: List[Dict[str, Any]] = []
        para_id = 0

        # 过滤页眉页脚（顶部5%和底部8%区域）
        top_threshold = page_height * 0.05
        bottom_threshold = page_height * 0.92

        for block in blocks:
            # blocks 返回: (x0, y0, x1, y1, "text", block_no, block_type)
            x0, y0, x1, y1 = block[0], block[1], block[2], block[3]
            block_type = block[6]

            if block_type == 1:  # 图片块
                images.append({
                    "id": len(images),
                    "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
                })
                continue

            # 文本块
            text = block[4].strip() if block[4] else ""

            # 跳过空文本、页眉页脚、页码
            if not text:
                continue
            if y0 < top_threshold and len(text) < 60:
                continue  # 大概率是页眉
            if y1 > bottom_threshold and len(text) < 60:
                continue  # 大概率是页脚/页码

            # 清理文本：修复字母间空格（如 "O R I G I N A L" → "ORIGINAL"）
            cleaned = _clean_text(text)
            if not cleaned or len(cleaned) < 3:
                continue

            # 跳过纯数字/纯页码
            if cleaned.strip().isdigit():
                continue

            paragraphs.append({
                "id": para_id,
                "text": cleaned,
                "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
            })
            para_id += 1

        result["pages"].append({
            "page_num": page_num + 1,
            "width": page_width,
            "height": page_height,
            "paragraphs": paragraphs,
            "images": images,
        })

    doc.close()
    return result


def _clean_text(text: str) -> str:
    """清理 PDF 提取的文本"""
    # 1. 先按多个空格或换行分割成段，保留分隔符
    # 这样 "ORIGINAL  PAPER" 的双空格作为分隔符保留，不会合并为一个词
    segments = re.split(r'( {2,}|\n+)', text)

    for i, seg in enumerate(segments):
        if len(seg) < 2 or seg.isspace():
            continue

        # 2. 合并大写字母间距: "O R I G I N A L" → "ORIGINAL"
        seg = re.sub(r'(?<=[A-Z]) (?=[A-Z])', '', seg)

        # 3. 检测并合并小写字母间距伪影
        words = seg.split()
        if len(words) > 1:
            single_char = sum(1 for w in words if len(w) == 1)
            if single_char / len(words) > 0.4:
                seg = seg.replace(' ', '')

        segments[i] = seg

    text = ''.join(segments)

    # 4. 标准化空白
    text = re.sub(r'[ \t]+', ' ', text)

    # 5. 修复标点前的空格
    text = re.sub(r'\s+([,.;:!?])', r'\1', text)

    # 6. 修复标点后缺少的空格
    text = re.sub(r'([,.;:!?])([A-Za-z])', r'\1 \2', text)

    # 7. 移除特殊字符和软连字符
    text = re.sub(r'[•●▪▶◆†‡§¶­​‌‍﻿]', '', text)

    # 8. 清理换行（短行合并到上一行）
    lines = text.split('\n')
    cleaned_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # 移除单独的数字行（PDF 内容流伪影）
        if re.match(r'^\d+$', line):
            continue
        if cleaned_lines and len(line) < 40 and not line.endswith(('.', '?', '!')):
            cleaned_lines[-1] += ' ' + line
        else:
            cleaned_lines.append(line)

    return '\n'.join(cleaned_lines).strip()


def extract_page_image(file_path: str, page_num: int, zoom: float = 1.5) -> str | None:
    """提取指定页面的渲染图像，返回 base64 编码的 PNG"""
    import base64
    doc = fitz.open(file_path)
    if page_num < 0 or page_num >= len(doc):
        doc.close()
        return None
    page = doc[page_num]
    # 使用较低的缩放率减小图片大小
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix)
    img_bytes = pix.tobytes("png")
    doc.close()
    return base64.b64encode(img_bytes).decode("utf-8")


def _is_header_footer(text: str, y0: float, page_height: float, page_width: float) -> bool:
    """判断文本块是否为页眉/页脚/页码/水印"""
    # 位置过滤：顶部 5% 或底部 8%
    if y0 < page_height * 0.05 or y0 > page_height * 0.92:
        text_stripped = text.strip()
        # 页码模式: "4 of 14", "Page 3", "123"
        if re.match(r'^\d+\s+of\s+\d+', text_stripped):
            return True
        if re.match(r'^(Page|page|Pág\.|p\.)\s*\d+', text_stripped):
            return True
        if text_stripped.isdigit():
            return True
        # 期刊名、版权、DOI 等常见页眉页脚
        if re.search(r'(Cancer Medicine|©|DOI|https?://)', text_stripped):
            return True
        # 短文本（小于 40 字符）在边距区域大概率是页眉页脚
        if len(text_stripped) < 60:
            return True
    return False


def _detect_columns(blocks_data: list, page_width: float) -> int:
    """检测页面是否为多栏布局，返回栏数（1 或 2）"""
    x_centers = []
    for block in blocks_data:
        if block["type"] != 0:
            continue
        bbox = block.get("bbox", (0, 0, 0, 0))
        x0, x1 = bbox[0], bbox[2]
        # 忽略跨页宽度的块（如页眉页脚贯穿左右）
        if x1 - x0 > page_width * 0.6:
            continue
        cx = (x0 + x1) / 2
        # 忽略明显在边距的块
        if cx < page_width * 0.05 or cx > page_width * 0.95:
            continue
        x_centers.append(cx)

    if len(x_centers) < 4:
        return 1

    x_centers.sort()
    # 找最大间隔
    max_gap = 0
    gap_idx = 0
    for i in range(len(x_centers) - 1):
        gap = x_centers[i + 1] - x_centers[i]
        if gap > max_gap:
            max_gap = gap
            gap_idx = i

    # 如果最大间隔超过页面宽度的 20%，认为是多栏
    if max_gap > page_width * 0.20:
        left_count = gap_idx + 1
        right_count = len(x_centers) - left_count
        # 每栏至少要有 2 个块
        if left_count >= 2 and right_count >= 2:
            # 确认左右分栏：左侧块的中心都在左半页，右侧都在右半页
            mid = x_centers[gap_idx] + max_gap / 2
            left_center = sum(x_centers[:left_count]) / left_count
            right_center = sum(x_centers[left_count:]) / right_count
            if left_center < page_width * 0.5 and right_center > page_width * 0.5:
                return 2

    return 1


def _assign_column(bbox: tuple, page_width: float, num_cols: int) -> int:
    """根据块的 x 中心确定属于哪一栏（0-based）"""
    if num_cols <= 1:
        return 0
    cx = (bbox[0] + bbox[2]) / 2
    if cx < page_width * 0.5:
        return 0  # 左栏
    else:
        return 1  # 右栏


def _looks_like_table_row(text: str) -> bool:
    """启发式检测文本是否为表格行（多个空格分隔的字段）"""
    # 多个连续空格分隔的字段
    if re.search(r' {3,}', text):
        parts = re.split(r' {2,}', text)
        # 至少 3 列且每列不超 30 字符
        if len(parts) >= 3 and all(len(p.strip()) < 30 for p in parts):
            return True
    return False


def _table_text_to_markdown(text: str) -> list[str] | None:
    """将表格文本转为 Markdown 表格行"""
    lines = text.strip().split('\n')
    if len(lines) < 2:
        return None

    # 用空格分割解析每一列
    rows = []
    for line in lines:
        parts = re.split(r' {2,}', line.strip())
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) >= 3:
            rows.append(parts)

    if len(rows) < 2:
        return None

    # 检查列数一致性
    col_count = len(rows[0])
    rows = [r for r in rows if len(r) == col_count]
    if len(rows) < 2:
        return None

    header = rows[0]
    md = ["| " + " | ".join(header) + " |",
          "| " + " | ".join(["---"] * col_count) + " |"]
    for row in rows[1:]:
        md.append("| " + " | ".join(row) + " |")
    return md


def page_to_markdown(page) -> str:
    """
    将 PDF 页面转换为 Markdown 格式，保留标题/列表/段落/表格结构。
    支持多栏布局检测，按正确阅读顺序排列内容。
    """
    page_width = page.rect.width
    page_height = page.rect.height
    dict_data = page.get_text("dict")
    blocks = dict_data["blocks"]

    # 收集所有字号，确定正文基础字号（中位数）
    font_sizes = []
    for block in blocks:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                font_sizes.append(span["size"])

    if not font_sizes:
        text_parts = []
        for b in page.get_text("blocks"):
            if b[6] == 0:
                t = _clean_text(b[4]).strip()
                if t and len(t) > 3:
                    text_parts.append(t)
        return "\n\n".join(text_parts)

    font_sizes.sort()
    median_size = font_sizes[len(font_sizes) // 2]
    heading_threshold = median_size * 1.15

    def _process_block(block):
        """处理文本块，返回 (y0, x0, col, [markdown_lines], type) 或 None"""
        bbox = block.get("bbox", (0, 0, 0, 0))
        y0, x0 = bbox[1], bbox[0]

        # 页眉页脚过滤
        full_text = ""
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                full_text += span.get("text", "")
        if _is_header_footer(full_text, y0, page_height, page_width):
            return None

        parts, is_heading, is_bullet, is_numbered = [], False, False, False

        for line in block.get("lines", []):
            text, max_size = "", 0
            for span in line.get("spans", []):
                t = span.get("text", "")
                if span["size"] > max_size:
                    max_size = span["size"]
                text += t
            text = _clean_text(text).strip()
            if not text:
                continue
            if max_size >= heading_threshold:
                is_heading = True
            if text.startswith(("•", "-", "–", "*")) and len(text) > 2:
                is_bullet = True
                text = text.lstrip("•-–* ").strip()
            if re.match(r'^\d+[.、)]\s', text):
                is_numbered = True
                text = re.sub(r'^\d+[.、)]\s*', '', text)
            parts.append(text)

        if not parts:
            return None

        col = _assign_column(bbox, page_width, num_cols)

        if is_heading:
            return (y0, x0, col, [f"## {' '.join(parts)}"], "heading")
        elif is_bullet:
            return (y0, x0, col, [f"- {p}" for p in parts], "list")
        elif is_numbered:
            return (y0, x0, col, [f"{i}. {p}" for i, p in enumerate(parts, 1)], "list")
        else:
            return (y0, x0, col, [" ".join(parts)], "para")

    # 检测栏数
    num_cols = _detect_columns(blocks, page_width)

    # 收集文本块（已过滤页眉页脚）
    items = []
    for block in blocks:
        if block["type"] != 0:
            continue
        r = _process_block(block)
        if r:
            items.append(r)

    # 检测表格并转为 Markdown 表格
    table_items = []
    try:
        tables = page.find_tables()
        for table in tables.tables:
            rows = table.extract()
            if not rows or len(rows) < 1:
                continue
            bbox = table.bbox
            ty0 = bbox[1] if bbox else 0
            # 跳过页眉页脚区域的表格
            if _is_header_footer("table", ty0, page_height, page_width):
                continue
            header = [str(c or "") for c in rows[0]]
            md = ["| " + " | ".join(header) + " |",
                  "| " + " | ".join(["---"] * len(header)) + " |"]
            for row in rows[1:]:
                md.append("| " + " | ".join(str(c or "") for c in row) + " |")
            tcol = _assign_column((bbox[0], bbox[1], bbox[2], bbox[3]), page_width, num_cols)
            table_items.append((ty0, tcol, md, "table"))
    except Exception:
        pass

    # 合并文本项和表格项
    all_items = items + table_items

    if num_cols >= 2:
        # 多栏布局：先按栏排序，栏内按 Y 排序
        all_items.sort(key=lambda x: (x[2], x[0], x[1]))
    else:
        # 单栏布局：按 Y 排序
        all_items.sort(key=lambda x: (x[0], x[1]))

    # 检测连续的多行空格分隔文本 → 合并为表格
    merged_items = []
    i = 0
    while i < len(all_items):
        y0, x0, col, md_lines, typ = all_items[i]
        # 如果当前是段落文本且看起来像表格行，尝试收集多行组成表格
        if typ == "para" and len(md_lines) == 1 and _looks_like_table_row(md_lines[0]):
            table_rows = [md_lines[0]]
            j = i + 1
            while j < len(all_items):
                _, _, _, next_lines, next_typ = all_items[j]
                if next_typ == "para" and len(next_lines) == 1 and _looks_like_table_row(next_lines[0]):
                    table_rows.append(next_lines[0])
                    j += 1
                else:
                    break
            if len(table_rows) >= 2:
                result = _table_text_to_markdown("\n".join(table_rows))
                if result:
                    merged_items.append((y0, x0, col, result, "table"))
                    i = j
                    continue
        merged_items.append(all_items[i])
        i += 1
    all_items = merged_items

    # 输出
    out, prev_y = [], -100
    prev_col = -1
    for y0, x0, col, md_lines, typ in all_items:
        # 多栏切换时加空行
        if num_cols >= 2 and prev_col != -1 and col != prev_col:
            out.append("")
        if out and abs(y0 - prev_y) > 12:
            out.append("")
        out.extend(md_lines)
        prev_y = y0
        prev_col = col

    return "\n".join(out).strip()