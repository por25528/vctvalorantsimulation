/**
 * ui/components/RankBadge.js — the reusable rank-tier badge (Iron → Radiant).
 *
 * Surfaces a player's competitive rank-tier at a glance wherever players are
 * listed (the Player screen, leaderboards, the ladder, rosters). Icon-based +
 * token-styled — a faceted rank gem (`Icon('rank')`) coloured by tier via the
 * `.rank-badge--<key>` BEM modifier in main.css (no hardcoded colours, no
 * emoji). The tier truth comes from r9's `playerRankTier` through the adapter.
 *
 * Pure props → VNode; serializes headlessly via toHtml like every component.
 */

import { h, classNames } from '../render.js';
import { Icon } from './Icon.js';
import { playerRankTier } from '../rankSelectors.js';
import { tierMeta } from '../rankTier.js';

/**
 * @param {object} props
 * @param {object} [props.player]   a player — its tier is resolved via the selector
 * @param {string} [props.tier]     an explicit tier token (key or label); overrides `player`
 * @param {number} [props.rr]       rank-rating (0–99) shown when `showRr` is set
 * @param {number} [props.size=14]  gem size in px
 * @param {boolean} [props.showLabel=true] render the tier label beside the gem
 * @param {boolean} [props.showRr=false]   append the rank-rating (e.g. "· 42")
 * @param {string} [props.class]    extra wrapper class
 * @returns {import('../render.js').VNode|null}
 */
export function RankBadge(props) {
  const {
    player = null,
    tier = null,
    rr = null,
    size = 14,
    showLabel = true,
    showRr = false,
    class: extra = ''
  } = props || {};

  let resolvedTier = tier;
  let resolvedRr = rr;
  if (resolvedTier == null && player) {
    const got = playerRankTier(player) || {};
    resolvedTier = got.tier;
    if (resolvedRr == null) resolvedRr = got.rr;
  }

  const meta = tierMeta(resolvedTier);

  return h(
    'span',
    {
      class: classNames('rank-badge', `rank-badge--${meta.key}`, extra),
      title: showRr && resolvedRr != null ? `${meta.label} · ${resolvedRr} RR` : meta.label,
      'data-tier': meta.key
    },
    h('span', { class: 'rank-badge__gem', 'aria-hidden': 'true' }, Icon('rank', { size })),
    showLabel ? h('span', { class: 'rank-badge__label' }, meta.label) : null,
    showRr && resolvedRr != null
      ? h('span', { class: 'rank-badge__rr' }, String(resolvedRr))
      : null
  );
}
