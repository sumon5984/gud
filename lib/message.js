// chat id string/number/username/"me" sob accept kore
const toPeer = (id) => {
  if (typeof id === "string" && /^-?\d+$/.test(id)) {
    const n = Number(id);
    return Number.isSafeInteger(n) ? n : id;
  }
  return id;
};

const isPlainObj = (v) =>
  v && typeof v === "object" && !Buffer.isBuffer(v) && v.constructor === Object;

export class Msg {
  constructor(client, raw) {
    this.client = client;
    this.raw = raw;
  }

  // ── info ──
  get id() { return this.raw.id; }
  get chatId() { return this.raw.chatId?.toString(); }
  get senderId() { return this.raw.senderId?.toString(); }
  get text() { return this.raw.message || ""; }
  get date() { return this.raw.date; }
  get fromMe() { return !!this.raw.out; }
  get isGroup() { return !!this.raw.isGroup; }
  get isPrivate() { return !!this.raw.isPrivate; }
  get isChannel() { return !!this.raw.isChannel; }
  get replyToId() { return this.raw.replyToMsgId; }
  get hasMedia() { return !!this.raw.media; }
  get mediaType() {
    const r = this.raw;
    if (!r.media) return null;
    if (r.sticker) return "sticker";
    if (r.gif) return "gif";
    if (r.voice) return "voice";
    if (r.audio) return "audio";
    if (r.video) return "video";
    if (r.photo) return "image";
    if (r.document) return "document";
    return "other";
  }

  // command hole set hoy (index.js theke)
  command = null;
  args = "";

  // ── peer resolve (entity cache miss fix) ──
  async _peer() {
    try {
      const p = await this.raw.getInputChat();
      if (p) return p;
    } catch {}
    try {
      const c = await this.raw.getChat();
      if (c) return c;
    } catch {}
    return this.raw.peerId;
  }

  async _resolve(chat) {
    if (typeof chat === "object" && chat?.className) return chat;
    return toPeer(chat);
  }

  // ── send ──
  // msg.send("hi")            -> same chat
  // msg.send(id, "hi")        -> onno chat
  // msg.send("hi", {opts})    -> options soho
  // msg.send(id, "hi", {opts})
  async send(a, b, c) {
    if (typeof b === "string") return this._send(a, b, c);
    return this._send(await this._peer(), a, b);
  }

  async _send(chat, text, opts = {}) {
    const peer = await this._resolve(chat);
    return this.client.sendMessage(peer, { message: String(text), ...opts });
  }

  async reply(text, opts = {}) {
    return this._send(await this._peer(), text, { replyTo: this.id, ...opts });
  }

  // msg.sendFile(file, {caption})  /  msg.sendFile(id, file, {caption})
  // file = path | Buffer | url
  async sendFile(a, b, c) {
    if (b !== undefined && !isPlainObj(b)) return this._sendFile(a, b, c);
    return this._sendFile(await this._peer(), a, b);
  }

  async _sendFile(chat, file, opts = {}) {
    const peer = await this._resolve(chat);
    return this.client.sendFile(peer, { file, ...opts });
  }

  // ── actions ──
  async edit(text, opts = {}) {
    return this.client.editMessage(await this._peer(), {
      message: this.id,
      text,
      ...opts,
    });
  }

  async delete(revoke = true) {
    return this.client.deleteMessages(await this._peer(), [this.id], { revoke });
  }

  async forward(to) {
    return this.client.forwardMessages(toPeer(to), {
      messages: [this.id],
      fromPeer: await this._peer(),
    });
  }

  // outputFile dile file save hoy, na dile Buffer return kore
  download(outputFile) {
    return this.client.downloadMedia(this.raw, outputFile ? { outputFile } : {});
  }

  // ── lookup ──
  async getReply() {
    const r = await this.raw.getReplyMessage();
    return r ? new Msg(this.client, r) : null;
  }
  getSender() { return this.raw.getSender(); }
  getChat() { return this.raw.getChat(); }
}