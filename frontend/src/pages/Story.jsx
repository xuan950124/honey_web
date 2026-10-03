import { StoryChapters, StoryCta, StoryHeader } from '../components/sections/PageSections'

export default function Story() {
  return (
    <>
      <StoryHeader />

      <section className="section">
        <div className="container"><StoryChapters /></div>
      </section>

      <section className="cta-band">
        <div className="container"><StoryCta /></div>
      </section>
    </>
  )
}
