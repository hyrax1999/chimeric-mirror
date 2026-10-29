# Distribution review

Reviewed on 2026-10-29. The bundled runtime distribution review remains in progress for this private research preview.

Chimeric currently preserves the upstream application's interface and research engine through revision-checked integration patches. Replacing its account, hosted services, transport and product branding does not establish a redistribution grant for the remaining upstream files.

## Primary sources

- [Claude Science: Legal and compliance](https://claude.com/docs/claude-science/legal-and-compliance) states that Team and Enterprise use is subject to Commercial Terms, and Pro and Max use is subject to Consumer Terms. The page reserves Anthropic's rights.
- [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms), section D.4, restrict reverse engineering and duplication. Section F states that rights to the other party's intellectual property are not granted implicitly.
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms) are linked by the product's license page. Applicable terms and statutory exceptions need to be assessed for the actual distribution and jurisdiction.

This review did not identify an upstream open-source license granting redistribution of the complete preserved application. That is the scope of the current evidence, not a categorical legal conclusion about every possible permission, exception, or jurisdiction.

## Source package boundary

The source exporter excludes the original executable, recovered runtime, original frontend bundle, development profiles and research data. It includes Chimeric integration code, revision-specific patch descriptions, tests and build tools. Some compatibility fixtures quote small upstream implementation boundaries; their provenance remains upstream.

New Chimeric source contributions are selected for the Apache License 2.0 in the repository `LICENSE`. That grant applies only to eligible new contributions. Excluding a binary does not itself resolve the terms applicable to modification tools or upstream excerpts, and the Apache selection cannot relicense upstream material. The source publication and bundled distribution remain under review against their actual contents before either is represented as cleared.

## Evidence needed to close this gate

Record an applicable upstream redistribution grant, or obtain an independent implementation and asset set with established distribution rights. Any change to the preserved engine/interface architecture requires alignment with the product owner. Keep component notices and the selected license for new contributions accurate while the assessment continues.

Technical checks continue independently. Passing the test suite does not close this distribution gate.
