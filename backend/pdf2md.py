#!/usr/bin/env python3
"""
PDF 页面内容提取工具 - 按正确阅读顺序输出 Markdown

用法:
    python pdf2md.py <pdf路径> [页码]

    页码从 1 开始，省略则输出所有页面。
    输出结果写入 <pdf文件名>_page<N>.md 文件。
"""
import re
import sys
from typing import Any


def clean_text(text: str) -> str:
    """清理 PDF 提取的文本"""
    # 按多空格或换行分割
    segments = re.split(r'( {2,}|\n+)', text)

    for i, seg in enumerate(segments):
        if len(seg) < 2 or seg.isspace():
            continue

        # 合并大写字母间距: "O R I G I N A L" → "ORIGINAL"
        seg = re.sub(r'(?<=[A-Z]) (?=[A-Z])', '', seg)

        # 检测并合并单字符间距伪影
        words = seg.split()
        if len(words) > 1:
            single_char = sum(1 for w in words if len(w) == 1)
            if single_char / len(words) > 0.4:
                seg = seg.replace(' ', '')

        segments[i] = seg

    text = ''.join(segments)

    # 标准化空白
    text = re.sub(r'[ \t]+', ' ', text)
    # 修复标点前的空格
    text = re.sub(r'\s+([,.;:!?])', r'\1', text)
    # 修复标点后缺少的空格
    text = re.sub(r'([,.;:!?])([A-Za-z])', r'\1 \2', text)
    # 移除特殊字符
    text = re.sub(r'[•●▪▶◆†‡§¶­​‌‍﻿]', '', text)

    # 清理换行
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if re.match(r'^\d+$', line):  # 孤立数字行，跳过
            continue
        if cleaned and len(line) < 40 and not line.endswith(('.', '?', '!')):
            cleaned[-1] += ' ' + line
        else:
            cleaned.append(line)

    return '\n'.join(cleaned).strip()


def is_header_footer(text: str, y0: float, page_h: float, page_w: float) -> bool:
    """判断是否为页眉/页脚"""
    if y0 < page_h * 0.05 or y0 > page_h * 0.92:
        t = text.strip()
        if re.match(r'^\d+\s+of\s+\d+', t):
            return True
        if re.match(r'^(Page|page)\s*\d+', t):
            return True
        if t.isdigit():
            return True
        if re.search(r'(Cancer Medicine|©|DOI|https?://)', t):
            return True
        if len(t) < 60:
            return True
    return False


def detect_columns(blocks: list, page_w: float) -> int:
    """检测页面是否为双栏布局"""
    x_centers = []
    for b in blocks:
        if b["type"] != 0:
            continue
        x0, x1 = b["bbox"][0], b["bbox"][2]
        if x1 - x0 > page_w * 0.6:  # 跨页宽块跳过
            continue
        cx = (x0 + x1) / 2
        if cx < page_w * 0.05 or cx > page_w * 0.95:
            continue
        x_centers.append(cx)

    if len(x_centers) < 4:
        return 1

    x_centers.sort()
    max_gap, gap_idx = 0, 0
    for i in range(len(x_centers) - 1):
        gap = x_centers[i + 1] - x_centers[i]
        if gap > max_gap:
            max_gap, gap_idx = gap, i

    if max_gap > page_w * 0.20:
        left_cnt = gap_idx + 1
        right_cnt = len(x_centers) - left_cnt
        if left_cnt >= 2 and right_cnt >= 2:
            mid = x_centers[gap_idx] + max_gap / 2
            lc = sum(x_centers[:left_cnt]) / left_cnt
            rc = sum(x_centers[left_cnt:]) / right_cnt
            if lc < page_w * 0.5 and rc > page_w * 0.5:
                return 2
    return 1


def assign_col(bbox: tuple, page_w: float, num_cols: int) -> int:
    """判断块属于哪一栏（0=左, 1=右）"""
    if num_cols <= 1:
        return 0
    cx = (bbox[0] + bbox[2]) / 2
    return 0 if cx < page_w * 0.5 else 1


def looks_like_table_row(text: str) -> bool:
    """检测是否为表格行（3+ 空格分隔的字段）"""
    return bool(re.search(r' {3,}', text) and
                len(re.split(r' {2,}', text)) >= 3)


def table_text_to_md(text: str) -> list[str] | None:
    """将空格分隔的表格文本转为 Markdown 表格"""
    lines = text.strip().split('\n')
    if len(lines) < 2:
        return None

    rows = []
    for line in lines:
        parts = re.split(r' {2,}', line.strip())
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) >= 3:
            rows.append(parts)

    if len(rows) < 2:
        return None

    col_n = len(rows[0])
    rows = [r for r in rows if len(r) == col_n]
    if len(rows) < 2:
        return None

    md = ["| " + " | ".join(rows[0]) + " |",
          "| " + " | ".join(["---"] * col_n) + " |"]
    for row in rows[1:]:
        md.append("| " + " | ".join(row) + " |")
    return md


def page_to_markdown(page, page_num: int = 0) -> str:
    """
    将 PDF 页转为 Markdown，支持多栏布局、表格、标题检测。
    """
    pw = page.rect.width
    ph = page.rect.height
    dd = page.get_text("dict")
    blocks = dd["blocks"]

    # ---- 字号分析 ----
    font_sizes = []
    for b in blocks:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for span in line["spans"]:
                font_sizes.append(span["size"])

    if not font_sizes:
        parts = []
        for b in page.get_text("blocks"):
            if b[6] == 0:
                t = clean_text(b[4]).strip()
                if t and len(t) > 3:
                    parts.append(t)
        return "\n\n".join(parts)

    font_sizes.sort()
    median = font_sizes[len(font_sizes) // 2]
    heading_threshold = median * 1.15
    num_cols = detect_columns(blocks, pw)

    # ---- 处理文本块 ----
    def process_block(block):
        bbox = block.get("bbox", (0, 0, 0, 0))
        y0 = bbox[1]

        # 页眉页脚检查
        raw = ""
        for line in block.get("lines", []):
            for span in line["spans"]:
                raw += span.get("text", "")
        if is_header_footer(raw, y0, ph, pw):
            return None

        parts, is_h, is_b, is_n = [], False, False, False
        for line in block["lines"]:
            text, max_sz = "", 0
            for span in line["spans"]:
                t = span.get("text", "")
                if span["size"] > max_sz:
                    max_sz = span["size"]
                text += t
            text = clean_text(text).strip()
            if not text:
                continue
            if max_sz >= heading_threshold:
                is_h = True
            if text.startswith(("•", "-", "–", "*")) and len(text) > 2:
                is_b = True
                text = text.lstrip("•-–* ").strip()
            if re.match(r'^\d+[.、)]\s', text):
                is_n = True
                text = re.sub(r'^\d+[.、)]\s*', '', text)
            parts.append(text)

        if not parts:
            return None

        col = assign_col(bbox, pw, num_cols)

        if is_h:
            return (y0, col, [f"## {' '.join(parts)}"])
        elif is_b:
            return (y0, col, [f"- {p}" for p in parts])
        elif is_n:
            return (y0, col, [f"{i}. {p}" for i, p in enumerate(parts, 1)])
        else:
            return (y0, col, [" ".join(parts)])

    # ---- 收集文本 ----
    items = []
    for b in blocks:
        if b["type"] != 0:
            continue
        r = process_block(b)
        if r:
            items.append(r)

    # ---- 表格检测 ----
    try:
        tables = page.find_tables()
        for tbl in tables.tables:
            rows = tbl.extract()
            if not rows or len(rows) < 1:
                continue
            bbox = tbl.bbox
            ty0 = bbox[1] if bbox else 0
            if is_header_footer("table", ty0, ph, pw):
                continue
            hdr = [str(c or "") for c in rows[0]]
            md = ["| " + " | ".join(hdr) + " |",
                  "| " + " | ".join(["---"] * len(hdr)) + " |"]
            for row in rows[1:]:
                md.append("| " + " | ".join(str(c or "") for c in row) + " |")
            col = assign_col((bbox[0], bbox[1], bbox[2], bbox[3]), pw, num_cols)
            items.append((ty0, col, md))
    except Exception:
        pass

    # ---- 排序 ----
    if num_cols >= 2:
        items.sort(key=lambda x: (x[1], x[0]))  # 先栏后 y
    else:
        items.sort(key=lambda x: x[0])  # 仅按 y

    # ---- 后备：合并连续表格行 ----
    merged = []
    i = 0
    while i < len(items):
        y0, col, md_lines = items[i]
        if len(md_lines) == 1 and looks_like_table_row(md_lines[0]):
            rows = [md_lines[0]]
            j = i + 1
            while j < len(items) and looks_like_table_row(items[j][2][0]):
                rows.append(items[j][2][0])
                j += 1
            if len(rows) >= 2:
                result = table_text_to_md("\n".join(rows))
                if result:
                    merged.append((y0, col, result))
                    i = j
                    continue
        merged.append(items[i])
        i += 1
    items = merged

    # ---- 输出 ----
    out, prev_y, prev_col = [], -100, -1
    for y0, col, md_lines in items:
        if num_cols >= 2 and prev_col != -1 and col != prev_col:
            out.append("")
        if out and abs(y0 - prev_y) > 12:
            out.append("")
        out.extend(md_lines)
        prev_y, prev_col = y0, col

    return "\n".join(out).strip()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    pdf_path = sys.argv[1]
    try:
        import fitz
    except ImportError:
        print("需要安装 PyMuPDF: pip install PyMuPDF")
        sys.exit(1)

    doc = fitz.open(pdf_path)

    if len(sys.argv) >= 3:
        pages = [int(sys.argv[2]) - 1]  # 转为 0-indexed
    else:
        pages = range(len(doc))

    for idx in pages:
        if idx < 0 or idx >= len(doc):
            print(f"页码 {idx + 1} 超出范围 (共 {len(doc)} 页)")
            continue

        page = doc[idx]
        md = page_to_markdown(page)
        name = doc.name.replace('.pdf', '').rsplit('/', 1)[-1]
        out_file = f"{name}_page{idx + 1}.md"
        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(md)
        print(f"已写入 {out_file} ({len(md)} 字符)")

    doc.close()


if __name__ == "__main__":
    main()