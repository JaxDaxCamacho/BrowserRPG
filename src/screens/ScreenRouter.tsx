import { useGameStore } from '../state/store';
import { MainMenu } from './MainMenu';
import { PlaceholderScreen } from './PlaceholderScreen';

/** Shows the screen named by `game.screen`. Routing is game state, not URLs. */
export function ScreenRouter() {
  const screen = useGameStore((s) => s.game.screen);

  switch (screen) {
    case 'menu':
      return <MainMenu />;
    case 'partyCreation':
      return <PlaceholderScreen title="Create your party" milestone={3} next="leaderSelect" />;
    case 'leaderSelect':
      return <PlaceholderScreen title="Choose your leader" milestone={3} next="adventureSelect" />;
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
