(function () {
  if (!window.fbq) {
    const fbq = window.fbq = function () {
      fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };
    window._fbq = fbq;
    fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
    const script = document.createElement('script');
    script.async = true; script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }
  window.fbq('init', '2175744060029065');
  window.fbq('track', 'PageView');
  const sent = new Set();
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
