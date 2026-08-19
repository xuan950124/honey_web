import { StoryChapters, StoryCta, StoryHeader } from '../components/sections/PageSections'

export default function Story() {
  return (
    <>
      <section className="page-hero">
        <div className="container"><StoryHeader /></div>
      </section>

      <section className="section">
        <div className="container"><StoryChapters /></div>
      </section>

      <section className="section section--dark">
        <div className="container"><StoryCta /></div>
      </section>
    </>
  )
}
