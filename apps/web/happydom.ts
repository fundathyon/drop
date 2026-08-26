import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The URL is not decoration. Registered without one the document lands on
// `about:blank`, whose opaque origin makes happy-dom drop every cookie that
// carries attributes — `document.cookie = "k=v; path=/; max-age=…"` silently
// writes nothing, while a bare `k=v` works. Anything that persists a
// preference in a cookie then looks broken in tests and only in tests.
//
// Note for anyone tempted to add `disableIframePageLoading` to quiet the
// connection-refused logs a test with an <iframe> produces: that setting does
// not skip the load, it THROWS a NotSupportedError as the frame connects, and
// takes the whole run down with it.
GlobalRegistrator.register({ url: "http://localhost/" });
