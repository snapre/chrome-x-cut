import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const utils = require("../src/url-utils.js");

{
  const normalized = utils.normalizeTwitterImageUrl("https://pbs.twimg.com/media/Gabc123?format=jpg&name=small");
  assert.equal(normalized.url, "https://pbs.twimg.com/media/Gabc123?format=jpg&name=orig");
  assert.equal(normalized.mediaId, "Gabc123");
  assert.equal(normalized.extension, "jpg");
}

{
  const input = "https://scontent-lax3-2.cdninstagram.com/v/t51.2885-15/12345_n.jpg?stp=dst-jpg&_nc_sid=abc";
  const normalized = utils.normalizeMediaImageUrl(input, "https://www.threads.com/@annie_scor/post/DbEzD7REzHW/media");
  assert.equal(normalized.url, input);
  assert.equal(normalized.platform, "threads");
  assert.equal(normalized.mediaId, "12345_n");
  assert.equal(normalized.extension, "jpg");
}

{
  const input = "https://scontent.cdninstagram.com/v/t51.2885-15/98765_n.webp?sig=keep-me";
  const normalized = utils.normalizeMediaImageUrl(input, "https://www.instagram.com/p/Codex_123/");
  assert.equal(normalized.url, input);
  assert.equal(normalized.platform, "instagram");
  assert.equal(normalized.extension, "webp");
}

{
  const normalized = utils.normalizeMediaImageUrl(
    "https://scontent.xx.fbcdn.net/v/t1.0-9/photo.jpg?token=signed",
    "https://www.threads.net/@user/post/OldDomain123"
  );
  assert.equal(normalized.platform, "threads");
  assert.equal(normalized.url, "https://scontent.xx.fbcdn.net/v/t1.0-9/photo.jpg?token=signed");
}

{
  const normalized = utils.normalizeTwitterImageUrl("https://pbs.twimg.com/media/Gabc123.png?name=large");
  assert.equal(normalized.url, "https://pbs.twimg.com/media/Gabc123.png?name=orig&format=png");
  assert.equal(normalized.mediaId, "Gabc123");
  assert.equal(normalized.extension, "png");
}

{
  const base = "https://scontent-nrt6-1.cdninstagram.com/v/t51.82787-15/photo.heic";
  const original = `${base}?stp=dst-jpg_e35_tt6&oh=signed-original`;
  const small720 = `${base}?stp=dst-jpg_e35_s720x720_tt6&oh=signed-720`;
  const small640 = `${base}?stp=dst-jpg_e35_s640x640_tt6&oh=signed-640`;
  const small480 = `${base}?stp=cp6_dst-jpg_e35_p480x480_tt6&oh=signed-480`;

  assert.deepEqual(
    utils.sortMediaImageUrlsByQuality([small480, small640, original, small720]),
    [original, small720, small640, small480]
  );
  assert.equal(utils.getMediaImageQualityScore(original), 1_000_000_000);
  assert.equal(utils.getMediaImageQualityScore(small720), 720 * 720);
  assert.match(utils.sortMediaImageUrlsByQuality([small640, original])[0], /oh=signed-original/);
}

assert.equal(
  utils.getPostIdFromPageUrl("https://www.threads.com/@annie_scor/post/DbEzD7REzHW/media"),
  "DbEzD7REzHW"
);
assert.equal(utils.getPostIdFromPageUrl("https://www.instagram.com/p/Codex_123/"), "Codex_123");
assert.equal(utils.getPostIdFromPageUrl("https://www.instagram.com/reel/Reel-456/"), "Reel-456");

{
  assert.equal(
    utils.getStatusIdFromPageUrl("https://x.com/ColorfulToilet/status/2064529372120519142/photo/1"),
    "2064529372120519142"
  );
}

{
  assert.equal(
    utils.makeImageFilename({ statusId: "2064529372120519142", mediaId: "Gabc123", extension: "jpg" }),
    "x-2064529372120519142-Gabc123.jpg"
  );
}

{
  assert.equal(
    utils.makeImageFilename({ platform: "threads", statusId: "DbEzD7REzHW", mediaId: "12345_n", extension: "jpg" }),
    "threads-DbEzD7REzHW-12345_n.jpg"
  );
}

assert.throws(() => utils.normalizeTwitterImageUrl("https://example.com/image.jpg"));
assert.throws(() => utils.normalizeMediaImageUrl("https://cdninstagram.com.evil.example/image.jpg"));
