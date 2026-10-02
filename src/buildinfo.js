// Build metadata. In the repository (development, tests) the commit is unknown;
// release packaging (tools/build-web.mjs) writes the exact commit into the
// staged copy of this file.
export const BUILD = { sha: '' };
