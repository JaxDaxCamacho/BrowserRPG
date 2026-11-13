import { useGameStore } from '../state/store';
import { LeaderSelect } from './LeaderSelect';
import { MainMenu } from './MainMenu';
import { PartyCreation } from './PartyCreation';
import { PlaceholderScreen } from './PlaceholderScreen';

/** Shows the screen named by `game.screen`. Routing is game state, not URLs. */
export function ScreenRouter() {
  const screen = useGameStore((s) => s.game.screen);

  switch (screen) {
    case 'menu':
      return <MainMenu />;
    case 'partyCreation':
      return <PartyCreation />;
    case 'leaderSelect':
      return <LeaderSelect />;
    case 'adventureSelect':
      return <PlaceholderScreen title="Pick an adventure" milestone={4} next="dialogue" />;
    case 'dialogue':
      return <PlaceholderScreen title="Dialogue" milestone={4} next="dungeon" />;
    case 'dungeon':
      return <PlaceholderScreen title="Dungeon" milestone={5} next="combat" />;
    case 'combat':
      return <PlaceholderScreen title="Combat" milestone={6} />;
  }
}
