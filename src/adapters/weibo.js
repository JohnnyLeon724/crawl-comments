'use strict';

function extractWeiboPostId(sourceUrl) {
  try {
    const parsed = new URL(String(sourceUrl || ''));
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'weibo.com' && hostname !== 'www.weibo.com') return '';

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) return '';

    const [authorOrDetail, statusToken] = segments;
    if (!authorOrDetail || !statusToken) return '';
    if (authorOrDetail === 'detail') return `detail/${statusToken}`;
    if (!/^\d+$/.test(authorOrDetail)) return '';
    return `${authorOrDetail}/${statusToken}`;
  } catch (_error) {
    return '';
  }
}

module.exports = {
  extractWeiboPostId
};
