import { useGameStore } from '../state/store';
import { AdventureSelect } from './AdventureSelect';
import { DialogueScreen } from './DialogueScreen';
import { DungeonScreen } from './DungeonScreen';
import { CombatScreen } from './CombatScreen';
import { WaitingRoom } from './Coop';
import { LeaderSelect } from './LeaderSelect';
import { MainMenu } from './MainMenu';
import { PartyCreation } from './PartyCreation';

/** Shows the screen named by `game.screen`. Routing is game state, not URLs. */
export function ScreenRouter() {
  const screen = useGameStore((s) => s.game.screen);
  const isClient = useGameStore((s) => s.net?.role === 'client');

  // Joined players wait while the host is on the menus; during party creation they make their own merc.
  if (isClient && (screen === 'menu' || screen === 'leaderSelect' || screen === 'adventureSelect')) {
    return <WaitingRoom />;
  }

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
      return <DungeonScreen />;
    case 'combat':
      return <CombatScreen />;
  }
}
