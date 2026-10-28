/* Supabase Auth + transactional RPC; no credentials are embedded in the site. */
(function (root) {
  'use strict';
  class CastleSync {
    // Native browser fetch requires its Window receiver when stored as a method.
    constructor(config, storage, fetcher = root.fetch.bind(root)) {
      this.config = config || {}; this.storage = storage; this.fetcher = fetcher;
      this.sessionKey = 'castleTracker.session'; this.session = null;
      if (this.config.url && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(this.config.url)) throw Error('同期先URLの形式が正しくありません。');
      if (this.config.publishableKey?.startsWith('sb_secret_')) throw Error('公開用キーを設定してください。秘密キーは使用できません。');
      const key = this.config.publishableKey || '';
      if (key.split('.').length === 3) {
        try { if (JSON.parse(atob(key.split('.')[1])).role !== 'anon') throw Error('unsafe'); }
        catch { throw Error('同期設定にはpublishable keyまたはanon keyのみ使用できます。'); }
      }
      try { this.session = JSON.parse(storage.getItem(this.sessionKey) || 'null'); } catch { /* sign in again */ }
    }
    get configured() { return Boolean(this.config.url && this.config.publishableKey); }
    async request(path, body, accessToken) {
      if (!this.configured) throw Error('クラウド同期の接続設定がまだありません。端末の記録は保存されています。');
      const response = await this.fetcher(this.config.url.replace(/\/$/, '') + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: this.config.publishableKey,
          ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: 'no-store'
      });
      let data; try { data = await response.json(); } catch { throw Error('同期先から応答を読み取れませんでした。記録は端末に残っています。'); }
      if (!response.ok) {
        if (response.status === 401 || response.status === 400 && path.startsWith('/auth/')) throw Error('ログイン情報を確認してください。必要なら再ログインしてください。');
        throw Error('同期できませんでした。通信と接続設定を確認してください。記録は端末に残っています。');
      }
      return data;
    }
    async signIn(email, password) {
      const data = await this.request('/auth/v1/token?grant_type=password', { email, password });
      this.setSession(data); return data.user;
    }
    async signUp(email, password) {
      return this.request('/auth/v1/signup?redirect_to=' + encodeURIComponent('https://chankagi.github.io/castle-tracker/'), { email, password });
    }
    setSession(data) {
      if (!data.access_token || !data.refresh_token || !data.user?.id) throw Error('ログインの応答を確認できませんでした。');
      const session = { access_token: data.access_token, refresh_token: data.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in,
        user: { id: data.user.id, email: data.user.email } };
      this.storage.setItem(this.sessionKey, JSON.stringify(session)); this.session = session;
    }
    async token() {
      if (!this.session) throw Error('同じアカウントでログインしてください。');
      if (this.session.expires_at < Date.now() / 1000 + 60) {
        const oldUser = this.session.user.id;
        const data = await this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: this.session.refresh_token });
        if (data.user?.id !== oldUser) throw Error('ログインのアカウントが変わりました。');
        this.setSession(data);
      }
      return this.session.access_token;
    }
    async exchange(state) {
      const token = await this.token();
      if (state.owner !== this.session.user.id) throw Error('この端末の記録とログイン先が一致しません。');
      const result = await this.request('/rest/v1/rpc/merge_castle_state', { incoming: state }, token);
      if (result.owner !== state.owner) throw Error('同期先のアカウントを確認できませんでした。');
      return result;
    }
    signOut() { this.storage.removeItem(this.sessionKey); this.session = null; }
  }
  root.CastleSync = CastleSync;
  if (typeof module === 'object' && module.exports) module.exports = CastleSync;
})(typeof globalThis !== 'undefined' ? globalThis : this);
