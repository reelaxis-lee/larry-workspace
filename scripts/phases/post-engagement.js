/**
 * post-engagement.js — Like and comment on LinkedIn feed posts
 * Runs before outreach to warm up the account (looks human)
 */

const { delays, sleep, randomBetween } = require('../utils/browser');
const { generatePostComment } = require('../utils/messenger');

async function runPostEngagement(page, config, results) {
  const likeTarget    = config.dailyLikeTarget || 7;
  const commentTarget = config.dailyCommentTarget || 3;

  console.log(`[${config.nickname}] Post engagement — likes: ${likeTarget}, comments: ${commentTarget}`);

  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await delays.afterPageLoad();

  let liked = 0;
  let commented = 0;
  let scrolls = 0;
  const maxScrolls = 15;

  // Track processed post IDs to prevent duplicate actions on the same post
  const likedPostIds    = new Set();
  const commentedPostIds = new Set();

  while ((liked < likeTarget || commented < commentTarget) && scrolls < maxScrolls) {
    // Get all visible posts — single selector to avoid union double-matching
    const rawPosts = await page.locator('[data-id^="urn:li:activity"]').all();

    // Deduplicate by data-id before processing (same element can match multiple times)
    const seenThisBatch = new Set();
    const posts = [];
    for (const p of rawPosts) {
      const pid = await p.getAttribute('data-id').catch(() => null);
      if (pid && !seenThisBatch.has(pid)) {
        seenThisBatch.add(pid);
        posts.push(p);
      }
    }

    for (const post of posts) {
      if (liked >= likeTarget && commented >= commentTarget) break;

      try {
        // Check if post is in viewport
        const box = await post.boundingBox().catch(() => null);
        if (!box || box.y < 0 || box.y > 2000) continue;

        // Get stable post ID to prevent duplicate actions
        const postId = await post.getAttribute('data-id').catch(() => null)
          || await post.getAttribute('id').catch(() => null)
          || null;

        // Get post text for context
        const postText = (await post.locator('[data-ad-preview="MESSAGE"], .feed-shared-text, .update-components-text').first()
          .textContent({ timeout: 2000 }).catch(() => '')).trim().substring(0, 400);

        // Parse author from control menu aria-label: "Open control menu for post by NAME"
        const ctrlBtn = post.locator('button[aria-label^="Open control menu for post by"]').first();
        const ctrlLabel = await ctrlBtn.getAttribute('aria-label').catch(() => '');
        const authorText = ctrlLabel?.replace('Open control menu for post by ', '').trim() || 'unknown';

        if (!postText || postText.length < 20) continue;

        // Like the post (if not already liked, not already processed, and under limit)
        if (liked < likeTarget && postId && !likedPostIds.has(postId)) {
          const likeBtn = post.locator('button[aria-label*="React Like"], button[aria-label*="Like"]').first();
          const isLiked = await likeBtn.getAttribute('aria-pressed').catch(() => null);

          if (isLiked === 'false' && await likeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            likedPostIds.add(postId);
            await likeBtn.click();
            liked++;
            results.postLikes = (results.postLikes || 0) + 1;
            console.log(`[${config.nickname}] Liked post by ${authorText} (${liked}/${likeTarget})`);
            await delays.betweenLikes();
          }
        }

        // Comment (if not already commented on this post, under limit, post is substantial)
        if (commented < commentTarget && postText.length > 100 && postId && !commentedPostIds.has(postId)) {
          const commentBtn = post.locator('button[aria-label*="comment" i], button:has-text("Comment")').first();
          if (!await commentBtn.isVisible({ timeout: 1000 }).catch(() => false)) continue;

          // Secondary DOM check — look for profile name already in this post's comments
          const alreadyCommented = await hasAlreadyCommented(post, config.name);
          if (alreadyCommented) {
            console.log(`[${config.nickname}] Already commented on ${authorText}'s post — skipping`);
            commentedPostIds.add(postId);
            continue;
          }

          console.log(`[${config.nickname}] Generating comment for post by ${authorText}...`);
          const comment = await generatePostComment(config, postText, authorText).catch(() => null);
          if (!comment) continue;

          // Mark BEFORE clicking — prevents retry if something goes wrong mid-flow
          commentedPostIds.add(postId);

          // Close any previously open comment editors before opening a new one
          await page.keyboard.press('Escape').catch(() => {});
          await sleep(500);

          await commentBtn.click();
          await sleep(randomBetween(1500, 2500));

          // Scope editor to THIS post element — prevents writing into a previously open editor
          const commentBox = post.locator('.ql-editor[contenteditable="true"]').first();
          if (!await commentBox.isVisible({ timeout: 3000 }).catch(() => false)) {
            await page.keyboard.press('Escape');
            continue;
          }

          await commentBox.click();
          await sleep(randomBetween(500, 1000));
          await commentBox.type(comment, { delay: randomBetween(35, 75) });
          await sleep(randomBetween(1000, 1800));

          // Scope submit button to THIS post element
          const submitBtn = post.locator('button.comments-comment-box__submit-button--cr, .comments-comment-box__submit-button').first();
          if (await submitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
            await submitBtn.click();
            commented++;
            results.postComments = (results.postComments || 0) + 1;
            console.log(`[${config.nickname}] Commented (${commented}/${commentTarget}): "${comment.substring(0, 60)}..."`);
            // Force-close the editor after submitting
            await sleep(1000);
            await page.keyboard.press('Escape').catch(() => {});
            await delays.betweenComments();
          } else {
            await page.keyboard.press('Escape');
          }
        }

      } catch (err) {
        console.log(`[${config.nickname}] Post engagement error: ${err.message.substring(0, 80)}`);
        await page.keyboard.press('Escape').catch(() => {});
        continue;
      }
    }

    // Scroll down to load more posts
    if (liked < likeTarget || commented < commentTarget) {
      await page.mouse.wheel(0, randomBetween(600, 1000));
      await sleep(randomBetween(2000, 4000));
      scrolls++;
    }
  }

  console.log(`[${config.nickname}] Post engagement done — liked: ${liked}, commented: ${commented}`);
  results.postLikes = liked;
  results.postComments = commented;
}

/**
 * Check if the profile has already commented on this post
 * by looking for their name in the existing comments section.
 */
async function hasAlreadyCommented(postEl, profileName) {
  try {
    // Expand comments if collapsed (look for "X comments" button)
    const commentsToggle = postEl.locator('button[aria-label*="comment" i]:has-text("comment")').first();
    if (await commentsToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
      await commentsToggle.click().catch(() => {});
      await postEl.page().waitForTimeout(1000).catch(() => {});
    }

    // Check for the profile's name in comment author elements
    const commentAuthors = await postEl.locator(
      '.comments-post-meta__name, .comment__actor-link, [data-test-id*="comment"] .feed-shared-actor__name'
    ).allTextContents().catch(() => []);

    const firstName = profileName.split(' ')[0].toLowerCase();
    const fullName  = profileName.toLowerCase();

    return commentAuthors.some(a =>
      a.toLowerCase().includes(fullName) || a.toLowerCase().includes(firstName)
    );
  } catch (_) {
    return false; // If check fails, proceed cautiously (dedup set is still the guard)
  }
}

module.exports = { runPostEngagement };
