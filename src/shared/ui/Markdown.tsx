import { Fragment, type ReactNode } from 'react'

/** Negrito (**x**), itálico (*x*) e código (`x`) inline — sem HTML cru, à prova de injeção. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={i++}>{tok.slice(1, -1)}</code>)
    else out.push(<em key={i++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Renderizador de Markdown mínimo para respostas da IA: parágrafos, títulos, listas
 * com marcadores e numeradas. Constrói elementos React (nunca dangerouslySetInnerHTML).
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (!line) {
      flushPara()
      flushList()
    } else if (heading) {
      flushPara()
      flushList()
      blocks.push(<h4 key={blocks.length}>{inline(heading[1])}</h4>)
    } else if (bullet || numbered) {
      flushPara()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return <Fragment>{blocks}</Fragment>
}
