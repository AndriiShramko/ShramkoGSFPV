import { AUTHOR, REPO, SITE } from "@/config/site";

type FaqItem = { q: string; a: string };

/** SoftwareApplication (+ author, source code) and, on the landing, FAQPage. Verified facts only. */
export default function JsonLd({ locale, description, faq }: { locale: string; description: string; faq?: FaqItem[] }) {
  const url = `${SITE}/${locale}/`;
  const graph: Record<string, unknown>[] = [
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE}/#app`,
      name: "ShramkoGSFPV",
      description,
      url,
      applicationCategory: "GameApplication",
      applicationSubCategory: "SimulationApplication",
      operatingSystem: "Windows, macOS (Chrome or Edge with WebGPU)",
      browserRequirements: "Requires WebGPU (Chrome or Edge); radios need WebHID",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      license: "https://opensource.org/licenses/MIT",
      codeRepository: REPO,
      sameAs: [REPO],
      inLanguage: ["en", "es", "pl", "ru"],
      author: { "@id": `${SITE}/#author` },
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${SITE}/#source`,
      name: "ShramkoGSFPV",
      codeRepository: REPO,
      programmingLanguage: "TypeScript",
      license: "https://opensource.org/licenses/MIT",
      targetProduct: { "@id": `${SITE}/#app` },
      author: { "@id": `${SITE}/#author` },
    },
    {
      "@type": "Person",
      "@id": `${SITE}/#author`,
      name: AUTHOR.name,
      url: AUTHOR.linkedin,
      email: `mailto:${AUTHOR.email}`,
      sameAs: [AUTHOR.linkedin, AUTHOR.github],
    },
  ];
  if (faq && faq.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      inLanguage: locale,
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
