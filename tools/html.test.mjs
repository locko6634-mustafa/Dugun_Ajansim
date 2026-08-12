import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../js/shared/html.js";

test("HTML kaçış yardımcısı işaretleme karakterlerini metne dönüştürür", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')"> &`),
    "&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp;"
  );
  assert.equal(escapeHtml(null), "");
});
