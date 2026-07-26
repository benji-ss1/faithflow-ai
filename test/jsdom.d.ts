// Minimal ambient typing for the dev-only `jsdom` test dependency. jsdom
// ships no bundled types; a full @types/jsdom devDependency would churn the
// lockfile for the two members the tests actually touch.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    // Tests reach through to browser globals (document, navigator, Blob,
    // URL, HTMLElement…) which have no precise cross-realm type here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window: any;
  }
}
