import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'

/**
 * 隱私權政策、服務條款、退換貨政策共用的頁面。
 *
 * 內容存在後台（政策條款），所以這裡只負責排版。
 * 用很輕量的 Markdown 子集渲染 —— 只支援 ##、表格、清單、粗體與引用，
 * 沒有引入 Markdown 套件是因為這幾份文件的格式很固定，
 * 為了它多背一個相依套件（以及它的 XSS 風險）不划算。
 */

const PAGES = {
  privacy: { key: 'policy_privacy', title: '隱私權政策', desc: '我們蒐集哪些資料、怎麼使用、你有什麼權利' },
  terms: { key: 'policy_terms', title: '服務條款', desc: '使用本站服務前請先閱讀' },
  refund: { key: 'policy_refund', title: '退換貨政策', desc: '食品類商品的退換貨規則與例外情形' },
}

/** 把 **粗體** 轉成 <strong>，其他一律當純文字（不解析 HTML，避免 XSS）。 */
function inline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-${i}`}>{part}</span>
  ))
}

function renderMarkdown(source) {
  const lines = (source || '').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i += 1; continue }

    // 標題
    if (line.startsWith('## ')) {
      blocks.push(<h2 key={i} className="policy__h2">{line.slice(3).trim()}</h2>)
      i += 1
      continue
    }

    // 表格：| a | b |  接著 |---|---|
    if (line.trim().startsWith('|') && (lines[i + 1] || '').includes('---')) {
      const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim())
      const head = cells(line)
      const body = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        body.push(cells(lines[i]))
        i += 1
      }
      blocks.push(
        <div className="table-wrap" key={`t${i}`} style={{ margin: '18px 0' }}>
          <table className="table">
            <thead><tr>{head.map((h, n) => <th key={n}>{inline(h, `h${n}`)}</th>)}</tr></thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>{row.map((c, n) => <td key={n}>{inline(c, `c${r}-${n}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 引用（我們用它來強調最重要的那幾句）
    if (line.startsWith('> ')) {
      const quote = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quote.push(lines[i].slice(2))
        i += 1
      }
      blocks.push(
        <blockquote className="policy__quote" key={`q${i}`}>
          {inline(quote.join(' '), `q${i}`)}
        </blockquote>,
      )
      continue
    }

    // 清單（- 或 1.）
    if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line)
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ''))
        i += 1
      }
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(
        <Tag className="policy__list" key={`l${i}`}>
          {items.map((it, n) => <li key={n}>{inline(it, `i${n}`)}</li>)}
        </Tag>,
      )
      continue
    }

    // 一般段落
    const para = []
    while (i < lines.length && lines[i].trim()
           && !lines[i].startsWith('## ') && !lines[i].startsWith('> ')
           && !lines[i].trim().startsWith('|')
           && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(<p key={`p${i}`} className="policy__p">{inline(para.join(''), `p${i}`)}</p>)
  }

  return blocks
}

export default function Policy({ page }) {
  const meta = PAGES[page] || PAGES.privacy
  const [content, setContent] = useState(null)
  const [error, setError] = useState('')
  const { settings } = useSettings()
  const location = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
    api.policies()
      .then((data) => setContent(data[meta.key] || ''))
      .catch((e) => setError(e.message))
  }, [meta.key, location.pathname])

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <h1 className="page-hero__title">{meta.title}</h1>
          <p className="page-hero__desc">{meta.desc}</p>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          {error && <div className="alert alert--error">{error}</div>}
          {content === null && !error && <div className="loading">載入中…</div>}

          {content !== null && (
            <div className="policy"
                 {...editable(meta.title, '/admin/policies', meta.key,
                   '這三份文件的內文都在「政策條款」裡改。')}>
              {renderMarkdown(content)}
            </div>
          )}

          <div className="policy__foot">
            <div className="small muted">
              最後更新：本頁內容如有調整會直接於此公告。
              {settings.contact_email && <>　有疑問請來信 {settings.contact_email}</>}
            </div>
            <div className="policy__links">
              <Link to="/privacy">隱私權政策</Link>
              <Link to="/terms">服務條款</Link>
              <Link to="/refund">退換貨政策</Link>
              <Link to="/contact">聯絡我們</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
