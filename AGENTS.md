# Delivery requirements

For every IncidOSINT update, complete validation, publication and live verification before reporting the update as finished.

## Checks

- Run `npm audit --audit-level=low`, `npm run lint`, `npx --no-install tsc --noEmit`, `node --test tests/*.test.mjs`, and `npm run build` when their inputs change.
- Verify the GitHub quality and repository-history secret-scan jobs for the exact commit being delivered. All checks must pass and the dependency audit must report zero vulnerabilities.
- Fix causes of failures. Do not skip tests, weaken security checks or suppress failures to obtain a passing result.

## Publication

- A GitHub merge does not publish this website. Publish every completed update through the existing Sites project `appgprj_6b022b1fb4e881918d78cefd78f1850c`.
- Preserve the existing public audience, custom domains, database, runtime secrets, ADS-B functionality and AIS functionality.
- Reconcile current GitHub main with the current Sites source before building; preserve concurrent changes and both histories.
- Build and package the same source that is pushed and saved as the deployment version. Use the supported Sites source and publication workflow; keep credentials out of files, arguments, logs and commits.
- Check the production deployment result and continue until it succeeds, or report the concrete blocker. Never describe a pending or failed deployment as live.

## Live verification

- Check the published website and its relevant public APIs after deployment, including the RNLI incident source when incident code changes.
- Keep published launch reports, station coordinates, received AIS vessel positions and inferred activity distinct. Never present a station pin as the rescue location.
- Report the live URL, deployment outcome, test results and security results. State any verification limit plainly.
- Do not stop after pushing, opening or merging a pull request when the user expects the update on the live website.

An explicit request for local-only work, a draft, a review, or saving without publication overrides the publication step.
