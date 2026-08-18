import assert from "node:assert/strict";
import test from "node:test";

import { describeRequestError } from "../js/shared/error-feedback.js";

test("beklenmeyen sunucu hatasını yönlendirici mesaj ve güvenli destek koduyla açıklar", () => {
  const feedback = describeRequestError({
    status: 500,
    message: "Bir hata oluştu.",
    payload: { requestId: "request_public_500" }
  });

  assert.equal(feedback.title, "Hizmet geçici olarak kullanılamıyor");
  assert.match(feedback.message, /birkaç dakika sonra tekrar deneyin/i);
  assert.match(feedback.message, /Destek kodu: request_public_500/);
  assert.equal(feedback.retryable, true);
});

test("sunucu içi hata ayrıntılarını ve dosya yollarını kullanıcıya yansıtmaz", () => {
  const feedback = describeRequestError({
    status: 500,
    message:
      "Invalid prisma.venue.findMany() invocation in C:\\app\\src\\routes\\public.routes.ts:236 Can't reach database server"
  });

  assert.match(feedback.message, /birkaç dakika sonra tekrar deneyin/i);
  assert.doesNotMatch(feedback.message, /prisma|public\.routes|database server|C:\\app/i);
});

test("operasyonel sunucu mesajını değiştirmez", () => {
  const feedback = describeRequestError({
    status: 409,
    message: "Seçilen salon bu saatte dolu. Başka bir saat seçin."
  });

  assert.equal(feedback.message, "Seçilen salon bu saatte dolu. Başka bir saat seçin.");
  assert.equal(feedback.title, "Bilgiler güncelliğini yitirdi");
});

test("ağ, doğrulama ve hız sınırı hatalarına uygulanabilir çözüm verir", () => {
  assert.match(describeRequestError({ status: 0 }).message, /İnternet bağlantınızı kontrol/i);
  assert.match(describeRequestError({ status: 400 }).message, /Bilgileri kontrol/);
  assert.match(describeRequestError({ status: 422 }).message, /İşaretli alanları kontrol/);
  assert.match(
    describeRequestError({ status: 429, retryAfterSeconds: 45 }).message,
    /45 saniye sonra/
  );
});

test("güvensiz destek referansını kullanıcıya yansıtmaz", () => {
  const feedback = describeRequestError({
    status: 500,
    payload: { requestId: "<script>alert(1)</script>" }
  });

  assert.equal(feedback.reference, "");
  assert.doesNotMatch(feedback.message, /script/);
});

test("beklenmeyen JavaScript ayrıntısını kullanıcıya sızdırmaz", () => {
  const feedback = describeRequestError({
    message: "TypeError: Cannot read properties of undefined (reading 'data')"
  });

  assert.equal(feedback.title, "Beklenmedik bir sorun oluştu");
  assert.match(feedback.message, /Sayfayı yenileyip tekrar deneyin/);
  assert.doesNotMatch(feedback.message, /TypeError|undefined|data/);
});
