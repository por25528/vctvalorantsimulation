/**
 * ui/components/BracketView.js — renders a bracket presentation model
 * (CONTRACTS-UI §6) as columns of clickable match cards.
 *
 * Pure `props -> VNode`: it reads `model` (from ui/derive.js buildBracketView),
 * looks team display info up in `teamsById`, and wires each card's onClick to
 * `onMatch(matchId)`. No `document`/`window`; renders headlessly via toHtml.
 */

import { h, classNames } from '../render.js';

/**
 * @param {Object} props
 * @param {Object} props.model       BracketView { bracketType, columns:[{id,label,matches}] }
 * @param {Object} [props.teamsById] teamId -> Team ({ tag, name })
 * @param {string|null} [props.followedTeamId]  highlight this team's run through the bracket
 * @param {(matchId:string)=>void} [props.onMatch]  click handler per match card
 * @returns {*} VNode
 */
export function BracketView(props) {
  const { model, teamsById = {}, followedTeamId = null, onMatch } = props || {};
  if (!model || !Array.isArray(model.columns)) {
    return h('div', { class: 'bracket bracket--empty' }, 'No bracket');
  }

  // The champion is the winner of the title-deciding match (only once it's played —
  // spoiler-safe). We accent every card on their winning run so the bracket reads as
  // "here's how they won it", which matters more to a spectator than a followed team.
  const championId = championOf(model);

  return h(
    'div',
    { class: classNames('bracket', `bracket--${model.bracketType}`) },
    model.columns.map((col) => BracketColumn({ col, teamsById, followedTeamId, championId, onMatch }))
  );
}

/** The title winner's teamId (winner of the played decidesTitle match), or null. */
function championOf(model) {
  for (const col of model.columns) {
    for (const m of col.matches) {
      if (m.decidesTitle && m.played) {
        if (m.a && m.a.winner) return m.a.teamId || null;
        if (m.b && m.b.winner) return m.b.teamId || null;
      }
    }
  }
  return null;
}

/** One bracket column (Upper / Middle / Lower …): a header + its rounds. */
function BracketColumn(props) {
  const { col, teamsById, followedTeamId, championId, onMatch } = props;

  // Group the column's matches into rounds (in order) so each wave gets a
  // labeled sub-header — the bracket reads Quarterfinal → Semifinal → Final
  // instead of an undifferentiated stack of cards.
  const order = [];
  const byRound = new Map();
  for (const m of col.matches) {
    const key = m.round || '';
    if (!byRound.has(key)) {
      byRound.set(key, []);
      order.push(key);
    }
    byRound.get(key).push(m);
  }

  return h(
    'div',
    { class: classNames('bracket__column', col.id === 'final' && 'bracket__column--final'), key: col.id, 'data-column': col.id },
    h('h3', { class: 'bracket__column-title' }, col.label),
    order.map((round) =>
      h(
        'div',
        { class: 'bracket__round-group', key: round },
        h('div', { class: 'bracket__round-label' }, shortRound(round, col.label)),
        byRound.get(round).map((m) => MatchCard({ match: m, teamsById, followedTeamId, championId, onMatch }))
      )
    )
  );
}

/** Drop the tier prefix from a round name (the column header already shows it). */
function shortRound(round, columnLabel) {
  let r = String(round || '').replace(/^(Upper|Middle|Lower)\s+/, '');
  if (columnLabel && r === columnLabel) return r;
  return r || 'Round';
}

/**
 * One match card: round label + two team rows (tag + map score), winner row
 * emphasized with `.bracket__match--won`. The title-deciding match crowns its
 * winner; the followed team's matches get an accent. Whole card is clickable.
 */
function MatchCard(props) {
  const { match, teamsById, followedTeamId, championId, onMatch } = props;
  const handler = typeof onMatch === 'function' ? () => onMatch(match.matchId) : undefined;
  const mine = !!(followedTeamId && match.played &&
    (match.a.teamId === followedTeamId || match.b.teamId === followedTeamId));
  // On the champion's path = the champion played this match and won it.
  const champWon = (s) => !!(championId && s && s.teamId === championId && s.winner);
  const onChampPath = match.played && (champWon(match.a) || champWon(match.b));

  return h(
    'div',
    {
      class: classNames('bracket__match', {
        'bracket__match--played': match.played,
        'bracket__match--pending': !match.played,
        'bracket__match--final': !!match.decidesTitle,
        'bracket__match--mine': mine,
        'bracket__match--champ': onChampPath
      }),
      key: match.matchId,
      'data-match': match.matchId,
      role: 'button',
      tabindex: '0',
      onClick: handler
    },
    TeamRow({ side: match.a, teamsById, followedTeamId, championId, crown: !!match.decidesTitle }),
    TeamRow({ side: match.b, teamsById, followedTeamId, championId, crown: !!match.decidesTitle }),
    h('div', { class: 'bracket__bo' }, `Bo${match.bestOf}`)
  );
}

/** One competitor row inside a match card. */
function TeamRow(props) {
  const { side, teamsById, followedTeamId, championId, crown } = props;
  const team = side && side.teamId ? teamsById[side.teamId] : undefined;
  const tag = team && team.tag ? team.tag : team && team.name ? team.name : 'TBD';
  const scoreText = side && side.score !== undefined && side.score !== null
    ? String(side.score)
    : '';
  const won = !!(side && side.winner);
  const mine = !!(followedTeamId && side && side.teamId === followedTeamId);
  const champ = !!(championId && side && side.teamId === championId);

  return h(
    'div',
    {
      class: classNames('bracket__team', {
        'bracket__match--won': won,
        'bracket__team--tbd': !(side && side.teamId),
        'bracket__team--followed': mine,
        'bracket__team--champ': champ
      }),
      'data-team': (side && side.teamId) || ''
    },
    // Crown the champion: the winning side of the title-deciding match.
    crown && won ? h('span', { class: 'bracket__crown', 'aria-label': 'Champion' }, '👑') : null,
    h('span', { class: 'bracket__tag' }, tag),
    h('span', { class: 'bracket__score' }, scoreText)
  );
}
