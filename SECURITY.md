# Security

Tool ini dirancang sebagai checker privat untuk credential yang dimiliki atau diotorisasi pengguna.

- Jangan jadikan endpoint publik tanpa APP_PASSWORD.
- Jangan mengirim credential pihak lain tanpa izin.
- Credential tidak dipersist ke database/file/localStorage.
- Error provider disanitasi dengan redaction credential.
- Custom OpenAI-compatible melakukan HTTPS enforcement, DNS resolve, dan pemblokiran localhost/RFC1918/link-local/private IP untuk mengurangi risiko SSRF.
- Jangan menambahkan fitur bulk credential checking, credential harvesting, atau scanning daftar key.
