import type { NovelArtifact } from "@harnest/template-novel";

export function NovelArtifactView({ artifact }: { artifact: NovelArtifact }) {
  return (
    <article className="novel-artifact">
      <div className="novel-artifact-meta">
        {artifact.chapters.length}장 · {artifact.chapters.reduce((sum, chapter) => sum + chapter.content.length, 0).toLocaleString()}자
      </div>
      <h1>{artifact.title}</h1>
      {artifact.chapters.map((chapter) => (
        <section key={chapter.id}>
          <h2>{chapter.title}</h2>
          {chapter.content.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </section>
      ))}
    </article>
  );
}
