import webpush from 'web-push';

const vapidKeys = webpush.generateVAPIDKeys();

console.log(`WEBPUSH_VAPID_PUBLICKEY=${vapidKeys.publicKey}`);
console.log(`WEBPUSH_VAPID_PRIVATEKEY=${vapidKeys.privateKey}`);
