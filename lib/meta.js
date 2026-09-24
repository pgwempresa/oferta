const crypto = require('node:crypto');
const PIXEL_ID = '2175744060029065';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

// Purchase intentionally means Pix generated, not payment settled, for this campaign.
async function pixGenerated(req, input, order, transactionId) {
  const eventId = 'pix_' + hash(String(transactionId));
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) return eventId;
  try {
    const userData = {em: [hash(order.client.email.trim().toLowerCase())]};
    if (req.headers['user-agent']) userData.client_user_agent = req.headers['user-agent'];
    for (const key of ['fbp', 'fbc']) {
      if (typeof input[key] === 'string' && /^fb\.\d+\.\d+\.[\w.-]{1,300}$/.test(input[key])) userData[key] = input[key];
    }
    const source = new URL(req.headers.origin);
    if (!['https:', 'http:'].includes(source.protocol)) return eventId;
    const event = {
      event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000),
      event_id: eventId, action_source: 'website', event_source_url: source.origin + '/',
      user_data: userData,
      custom_data: {currency: 'BRL', value: order.amount, payment_method: 'pix', payment_status: 'pending'}
    };
    const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events`, {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      body: JSON.stringify({data: [event]}), signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) console.warn('Meta CAPI: evento recusado; HTTP', response.status);
  } catch {
    // Analytics failures must never turn an already-created Pix into a payment error.
    console.warn('Meta CAPI: envio indisponível');
  }
  return eventId;
}
module.exports = {pixGenerated};
