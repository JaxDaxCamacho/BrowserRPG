import { getClass, getDialogue, getRace } from '../content';
import {
  checkMaker,
  chooseOption,
  continueDialogue,
  currentNode,
  unmetConditions,
  type Condition,
  type DialogueCheck,
  type DialogueResult,
  type StatName,
} from '../engine';
import { dialogueContext } from '../state/context';
import { useGameStore } from '../state/store';
import { formatModifier } from './MercCard';

const STAT_FULL_NAMES: Record<StatName, string> = {
  strength: 'Strength',
  agility: 'Agility',
  toughness: 'Toughness',
  intellect: 'Intellect',
  spirit: 'Spirit',
  charisma: 'Charisma',
};

function describeCondition(condition: Condition): string {
  switch (condition.type) {
    case 'partyHasClass':
      return `Needs a ${getClass(condition.classId).name} in the party`;
    case 'partyHasRace':
      return `Needs a ${getRace(condition.raceId).name} in the party`;
    case 'flag':
      return 'Not available';
  }
}

/** Turns an image key such as "guild-office" into a caption for the placeholder art. */
function imageCaption(key: string): string {
  const words = key.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
    </>
  );
}

function CheckReadout({ check }: { check: NonNullable<DialogueResult['check']> }) {
  return (
    <div className={`check-readout ${check.success ? 'success' : 'failure'}`} role="status">
      <span className="die" aria-hidden="true">
        {check.roll.natural}
      </span>
      <span>
        <strong>{check.success ? 'Success' : 'Failure'}</strong>
        <br />
        {check.mercName} rolls {STAT_FULL_NAMES[check.stat]}: {check.roll.natural} {formatModifier(check.modifier)} ={' '}
        {check.total} against {check.difficulty}
      </span>
    </div>
  );
}

export function DialogueScreen() {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);

  if (!game.dialogue || !game.adventureId) return null;
  const dialogue = getDialogue(game.adventureId, game.dialogue.dialogueId);
  const node = currentNode(game, dialogue);
  const result = game.dialogue.result;

  const checkLabel = (check: DialogueCheck) => {
    const maker = checkMaker(game, check, dialogueContext);
    return `${STAT_FULL_NAMES[check.stat]} ${check.difficulty} · ${maker.merc.name} ${formatModifier(maker.modifier)}`;
  };

  return (
    <main className="screen dialogue">
      <section className="dialogue-text" aria-live="polite">
        {node.speaker && <h1 className="speaker">{node.speaker}</h1>}
        {result ? <Paragraphs text={result.text} /> : <Paragraphs text={node.text} />}
      </section>

      <div className="dialogue-image" role="img" aria-label={node.image ? imageCaption(node.image) : 'Scene'}>
        <span className="dim">{node.image ? imageCaption(node.image) : 'Scene'}</span>
      </div>

      <section className="dialogue-options">
        {result ? (
          <>
            {result.check && <CheckReadout check={result.check} />}
            {result.notes.length > 0 && (
              <ul className="effect-notes">
                {result.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            <button type="button" className="primary" onClick={() => apply((g) => continueDialogue(g, dialogueContext))}>
              Continue
            </button>
          </>
        ) : (
          node.options.map((option) => {
            const unmet = unmetConditions(game, option);
            return (
              <button
                key={option.id}
                type="button"
                className="option"
                disabled={unmet.length > 0}
                onClick={() => apply((g) => chooseOption(g, dialogue, option.id, dialogueContext))}
              >
                <span>{option.text}</span>
                {unmet.length > 0 ? (
                  <span className="option-note">{unmet.map(describeCondition).join('. ')}</span>
                ) : (
                  option.check && <span className="option-note">{checkLabel(option.check)}</span>
                )}
              </button>
            );
          })
        )}
      </section>
    </main>
  );
}
