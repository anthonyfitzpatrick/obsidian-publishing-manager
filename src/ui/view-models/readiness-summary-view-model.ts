/** Text-first readiness presentation shared by headers and the later detailed workspace. */
import type { ReadinessEvaluation } from '../../domain/readiness/readiness-engine';

export interface ReadinessSummaryViewModel {
  readonly stateLabel: string;
  readonly scoreLabel: string;
  readonly confidenceLabel: string;
  readonly explanation: string;
}

/** Keeps score and confidence visibly separate and never converts unknown into a zero. */
export function buildReadinessSummary(
  evaluation: ReadinessEvaluation | undefined
): ReadinessSummaryViewModel {
  if (evaluation === undefined)
    return {
      stateLabel: '○ Rules pending',
      scoreLabel: 'Score —',
      confidenceLabel: 'Confidence —',
      explanation: 'The M5 engine is active; core publishing checks arrive in the next stage.'
    };
  return {
    stateLabel:
      evaluation.state === 'ready'
        ? '✓ Ready'
        : evaluation.state === 'not-ready'
          ? '✕ Not ready'
          : evaluation.state === 'attention'
            ? '△ Attention'
            : '? Unknown',
    scoreLabel: evaluation.score === null ? 'Score —' : `Score ${evaluation.score}%`,
    confidenceLabel:
      evaluation.confidence === null ? 'Confidence —' : `Confidence ${evaluation.confidence}%`,
    explanation: `${evaluation.results.length} rules evaluated for ${evaluation.scope.kind} scope.`
  };
}
