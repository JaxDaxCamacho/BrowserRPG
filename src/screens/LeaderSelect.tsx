import { leaderTally } from '../engine';
import { HOST_ID, votersFor } from '../net/protocol';
import { useControl } from '../state/net';
import { useGameStore } from '../state/store';
import { MercCard } from './MercCard';

export function LeaderSelect() {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const net = useGameStore((s) => s.net);
  const { isHost, myId } = useControl();

  // In co-op the leader is voted for: every player with a merc in the party has a say.
  const voters = net ? votersFor(net.session, game) : [];
  const votes = game.leaderVotes ?? {};
  const tally = net ? leaderTally(votes, voters) : {};
  const nameOf = (id: string) => (id === HOST_ID ? 'The host' : (net?.session.players.find((p) => p.id === id)?.name ?? 'A player'));
  const waitingOn = voters.filter((v) => !votes[v]);
  const myVote = votes[myId];

  return (
    <main className="screen wide">
      <header className="screen-header">
        <h1>{net ? 'Vote for your leader' : 'Choose your leader'}</h1>
        <p className="dim">
          The leader speaks for the party and marks its place on the map.
          {net && ' Everyone with a merc votes; the most votes wins, and the host breaks a tie.'}
        </p>
      </header>

      <div className="card-list leader-list">
        {game.party.map((merc) => {
          const count = tally[merc.id] ?? 0;
          const leading = merc.id === game.leaderId;
          const badge = leading ? 'Leader' : net && count > 0 ? `${count} vote${count === 1 ? '' : 's'}` : undefined;
          return (
            <MercCard
              key={merc.id}
              merc={merc}
              selected={net ? myVote === merc.id : leading}
              {...(badge ? { badge: leading && net && count > 0 ? `Leader · ${count} vote${count === 1 ? '' : 's'}` : badge } : {})}
              onSelect={() => dispatch({ type: 'voteLeader', mercId: merc.id })}
            />
          );
        })}
      </div>

      {net && (
        <p className="leader-votes dim">
          {waitingOn.length > 0
            ? `Waiting for ${waitingOn.map(nameOf).join(', ')} to vote.`
            : 'Everyone has voted. Votes can still change until the host confirms.'}
          {myVote ? ' Click another merc to change your vote.' : ' Click a merc to vote for them.'}
        </p>
      )}

      {isHost ? (
        <footer className="screen-footer">
          <button type="button" onClick={() => dispatch({ type: 'goToScreen', screen: 'partyCreation' })}>
            Back to party
          </button>
          <button type="button" className="primary" disabled={!game.leaderId} onClick={() => dispatch({ type: 'confirmLeader' })}>
            Confirm leader
          </button>
        </footer>
      ) : (
        <p className="dim">The host confirms the leader once everyone has voted.</p>
      )}
    </main>
  );
}
