(function () {
  // The standard base code is inline in index.html so Meta Pixel Helper detects it.
  // This file only contains the checkout event logic.
  const sent = new Set();
  window.trackInitiateCheckout = function (total, eventId) {
    try {
      const id = eventId || ('checkout_' + Date.now());
      if (sent.has(id)) return;
      window.fbq('track', 'InitiateCheckout', {
        value: Number(total) || 0, currency: 'BRL'
      }, {eventID: id});
      sent.add(id);
    } catch (_) { /* Pixel must not interrupt checkout. */ }
  };
  window.trackPixPurchase = function (data) {
    try {
      const id = data.metaEventId;
      if (!id || sent.has(id)) return;
      try { if (sessionStorage.getItem('meta:' + id)) return; } catch (_) {}
      window.fbq('track', 'Purchase', {
        value: data.total, currency: 'BRL', payment_method: 'pix', payment_status: 'pending'
      }, {eventID: id});
      sent.add(id);
      try { sessionStorage.setItem('meta:' + id, '1'); } catch (_) {}
    } catch (_) { /* Pixel must not interrupt checkout. */ }
  };
})();
