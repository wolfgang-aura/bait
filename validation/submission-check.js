import fs from 'node:fs';

export function inspectVideo(probe) {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format?.duration);
  return {
    duration,
    validDuration: duration >= 30 && duration <= 60,
    videoCodec: video?.codec_name,
    width: video?.width,
    height: video?.height,
    pixelFormat: video?.pix_fmt,
    audioCodec: audio?.codec_name,
    validFormat: video?.codec_name === 'h264' && video?.width === 1280 && video?.height === 720 &&
      video?.pix_fmt === 'yuv420p' && audio?.codec_name === 'aac',
  };
}

export function countJsonl(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).length;
}

export function inspectPrivateSubmission(record = {}) {
  return {
    emailReady: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(record.nansen_account_email ?? '')),
    xPostReady: /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(String(record.x_post_url ?? '')),
    formSubmitted: record.form_submitted === true,
  };
}

export function inspectXDraft(text = '') {
  const draft = String(text).trim();
  const effectiveLength = draft.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
  return {
    effectiveLength,
    valid: effectiveLength <= 280 && /Can true facts sell a losing trader to an AI\?/i.test(draft) &&
      draft.includes('@nansen_ai') && draft.includes('https://github.com/wolfgang-aura/bait') &&
      /wallet-allocation/i.test(draft) && /Nansen PnL/i.test(draft) &&
      draft.includes('24/30') && draft.includes('0/30') && draft.includes('https://bait-wyqr.onrender.com'),
  };
}
