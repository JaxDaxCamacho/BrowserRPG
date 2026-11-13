import { useGameStore } from '../state/store';
import { AdventureSelect } from './AdventureSelect';
import { DialogueScreen } from './DialogueScreen';
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
      return <AdventureSelect />;
    case 'dialogue':
      return <DialogueScreen />;
    case 'dungeon':
      return <PlaceholderScreen title="Dungeon" milestone={5} next="combat" />;
    case 'combat':
      return <PlaceholderScreen title="Combat" milestone={6} />;
  }
}
