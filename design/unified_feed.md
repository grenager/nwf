# NewsWithFriends: Product Strategy & Redesign

*Working document, July 2026*

---

## 1. ICP: The Intellectually Social Reader

Highly educated US news consumer who reads seriously (NYT, Atlantic, New Yorker, Substack authors like Heather Cox Richardson) and treats current events as social currency. They want to discuss the news intelligently with people they actually know - the dinner-party dynamic - not perform takes for strangers.

**What they do today and why it fails them:**

- **Facebook** is where they try to discuss news with real friends, but the experience is degraded: algorithmic noise, ads, family drama, and a platform they increasingly distrust.
- **Twitter/Bluesky/Reddit/Substack comments** offer discovery and discussion, but with strangers and celebrities, incentivizing performance over honesty.
- **News apps and aggregators** offer volume without meaning: no social layer, no endpoint, engagement-maximizing feeds.

**Unmet needs (revised through this process):**

1. **Discover** great new articles, authors, and outlets that shed light on current trends - the pieces they'd otherwise find via Twitter serendipity or a friend's email.
2. **Converse** about news and ideas with people they actually know, in an unguarded register they would never use in public.
3. **Earn social cred** among their circle by surfacing great pieces and adding smart commentary - taste as identity.
4. **A bounded daily ritual**: catch up in 5-30 minutes, reach a genuine end, get on with the day. Not another infinite feed.

**Explicitly demoted:** "never miss anything" comprehensiveness. We will not promise completeness. The daily edition acts as a trusted curation ("if it mattered, it's probably here") - a pleasant reality, not a contractual promise. This avoids an unwinnable arms race with Google News and keeps us out of the aggregator business.

---

## 2. The Promises

1. **You will discover cool new things** - articles, authors, and outlets chosen for quality, not volume.
2. **You will have interesting conversations with people you actually know** - private by default, honest in register, group-chat warm.
3. **It ends.** A finite daily edition. You get caught up, and then you're done. We are not ad-funded and do not engagement-max.

Positioning candidate: *"Read better things. Talk about them with people you actually know."*

**Design north star:** Letterboxd for news. The atomic action is *logging* (marking a piece read, optionally starring or adding a one-line take), not posting. Lurkers generate the feed just by reading. Taste profiles carry identity. Small friend graphs (10-15 people) are a complete experience because the daily edition gives everyone shared objects to converge on - big news stories are our Barbenheimer.

---

## 3. UX & Functionality Changes

### 3.1 Kill the three-column layout; ship a single unified feed
One river of "things worth discussing": news stories and analysis pieces are two card types in one feed, not two products. News cards decay fast (~48h); analysis cards have a long half-life and resurface when friends interact.

### 3.2 Kill the comprehensive aggregator; ship the daily edition
- Each day: 5-8 news stories (one canonical article per event) + 2-3 analysis pieces, editorially assembled.
- Reading happens off-platform (link out); **marking happens on-platform** (Read / ★ / one-line take on every card).
- Dedup at edition-assembly time: pick one canonical article per news event rather than maintaining cluster objects.

### 3.3 Kill event/cluster objects; ship the "attach" mechanic
Users attach related articles to a story when commenting ("here's the WSJ follow-up - it adds the financing detail"). The multi-source picture is rebuilt bottom-up as a social gesture that earns cred, replacing algorithmic source lists.

### 3.4 Inbox model, not infinite scroll
- Front-load the count: "4 conversations and 6 stories to catch up on."
- A real **"You're all caught up"** endpoint; everything below it is optional archive.
- Threads persist across editions: a friend's 9pm reply resurfaces in tomorrow's edition.

### 3.5 Rebuild the social layer around activity, not roster
- Replace the static Friends list with inline friend activity: reads as ambient presence ("Nadia read this"), comments shown in full on cards.
- Replies to threads you're in always rank first - the group-chat dopamine loop.
- Notifications/daily digest email as the ritual trigger.

### 3.6 Visibility model
- **Private by default.** Comments are visible to friends; the composer always shows "visible to: friends."
- **Per-item public toggle**, deliberate act. Public comments are read-only broadcast (no stranger replies) - a lobby, not a public square.
- **Thread visibility expands by participation**: the rule is *everyone within one hop of any participant sees everything*. A thread is visible to the friends of every participant; when a new person comments, their friends gain visibility too. Whole-thread visibility always - no fragmented threads, no partial views. Rationale: the fun comes from reading conversations where you personally know (and will see in person) many of the participants; a friend of a friend is a friend, at least for current-events discussion. This also gives every good conversation a built-in discovery/growth engine - each new commenter bridges the thread to their circle, and meeting a friend-of-a-friend in a thread is one tap from a new friendship.
- Make the expanding audience legible in the UI (e.g. "visible to friends of 4 participants") so nobody is surprised who's in the room.

### 3.7 Empty-state / seeding strategy
- Guests and 0-friend users see the daily edition + public comments from named contributors + aggregate activity ("214 readers, 31 private conversations you can't see") as the honest invite hook.
- **Never** recycle private comments, even anonymized - that breaks the core covenant.
- Editorial crew of 5-8 named contributors writes public takes on 3-4 stories daily; their register defines house style ("smart dinner guest, not poster").
- Expect 6-12 months of conversation seeding (Reddit precedent), but edition curation is permanent product, not scaffolding. Done-signal: median user sees 3+ private friend interactions/day organically.

### 3.8 Profiles as taste identity (later)
Letterboxd-style: reading diary, starred pieces, favorite authors. Powers the social-cred loop without follower counts or viral metrics.

---

## 4. Architectural Changes

### 4.1 Data model
- **Remove: the `event` object.** The current model has `story` and `event` (a cluster of stories about the same news event). We kill `event` entirely and stop doing automated clustering of stories. Multi-source breadth is instead rebuilt socially via attachments (3.3) and editorially via canonical-article selection at edition time (4.3). Optional secondary feature: an "other stories about this topic" module on story detail pages, computed on-demand (e.g. embedding similarity), with no persistent cluster state.
- **Story card** becomes the core entity: `{canonical_article, type: news|analysis, edition_date, editorial_rank, decay_class}`.
- **New: Attachment** - `{story_id, article_url, attached_by, comment_id?}`.
- **New: Thread** - first-class conversation object. Visibility resolves against the thread, not the comment: `audience = union(friend_ids of all participants)`, recomputed (or incrementally expanded) whenever a new participant comments. Visibility check: user is a participant, or is a friend of any participant.
- **New: Log entry** - `{user, story, read_at, rating?, take?}` - the Letterboxd atomic action; drives ambient presence.
- **Comment** gains `visibility: private|public` (default private, immutable after post is safest).
- **Edition** - `{date, ordered story list, editor}` - assembled daily, the shared object.

### 4.2 Feed assembly (one ranked query, three modes)

```
candidates = editorial_edition(today)
           ∪ stories_with_friend_activity(user, 7d)
           ∪ user's threads with unread replies
           ∪ public_layer stories (only if social candidates < N)

score = w1·editorial_rank
      + w2·friend_activity(reads, comments, attaches, closeness, recency)
      + w3·thread_resurrection (unread replies to you → pin to top)
      − decay(card_type, time_since_last_interaction)
```

- **Guest:** w2=w3=0; edition order + public comments + aggregate counts.
- **Few friends:** edition spine; any friend-touched card jumps above the fold; public layer backfills.
- **Many friends:** social weight dominates; edition is the floor; public layer hidden.
- **One card per story:** candidate threads are grouped by `story_id` at feed-assembly time. If two friends separately post the same article, the feed shows one story card with both threads listed beneath it ("Nadia posted this - 4 comments" / "Reed posted this - 2 comments"). Threads remain socially distinct rooms; the card is the deduped inbox item. Preserves the inbox promise (no duplicates to clear) without collapsing separate conversations. (Possible later: a "merge" invitation when both posters are mutual friends.)
- "All caught up" line = after (unread threads + today's edition).

### 4.3 Dedup service
Lightweight same-story detection at edition-assembly time only (embedding similarity over candidate links is sufficient). Resolves to one canonical article; no persistent cluster state.

### 4.4 Editorial pipeline
- Overnight LLM job drafts candidate edition (scrape/rank major outlets + volunteer-submitted links from a shared channel).
- Morning editor UI: veto, reorder, swap canonical links, publish by 7am ET. Target: 30-45 min/day, rotating crew.

### 4.5 Notifications & digest
- Event-driven: reply-to-your-thread (highest priority), friend commented on story you logged, weekly "what your circle read" recap.
- Morning digest email: "3 friends shared, 2 conversations active, today's edition is up."

### 4.6 What gets simpler
No cluster maintenance, no comprehensive ingestion pipeline, no per-comment ACL spaghetti (thread-level audience), no read-tracking across dozens of sources. The system shrinks: one feed query, one edition table, one thread visibility rule.