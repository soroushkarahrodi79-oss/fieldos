import type { Asset, EvidenceMethod, FieldSession, Observation, Uuid } from '../domain/types';

export type PlannedAssetExecutionStatus = 'NOT_COVERED' | 'COVERED';

export interface PlannedAssetExecution {
  assetId: Uuid;
  status: PlannedAssetExecutionStatus;
  observationCount: number;
  lastObservedAt: string | null;
}

export interface CampaignExecutionSummary {
  plannedAssetCount: number;
  coveredAssetCount: number;
  remainingAssetCount: number;
  coveragePercent: number | null;
  observationCount: number;
  observationsWithoutPlannedAsset: number;
  observationsWithoutRawGps: number;
  manualLocationAdjustmentCount: number;
  evidenceCounts: Record<EvidenceMethod, number>;
  assets: PlannedAssetExecution[];
  checkpoint: {
    status: 'READY_TO_REVIEW' | 'REVIEW_RECOMMENDED' | 'NO_PLANNED_ASSETS';
    issues: string[];
    disclosures: string[];
  };
}

/**
 * Derive campaign execution state from canonical evidence.
 *
 * No workflow status is persisted on Campaign or Asset. A planned asset is "covered" only when at
 * least one non-deleted observation from one of the campaign's sessions links to that asset.
 * "Covered" deliberately does NOT claim that the researcher physically visited the exact point.
 */
export function summarizeCampaignExecution(
  sessions: readonly FieldSession[],
  plannedAssets: readonly Asset[],
  observations: readonly Observation[],
): CampaignExecutionSummary {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const plannedAssetIds = new Set(plannedAssets.map((asset) => asset.id));
  const live = observations.filter((observation) => sessionIds.has(observation.sessionId) && !observation.deleted);

  const linked = new Map<Uuid, Observation[]>();
  for (const observation of live) {
    if (!observation.assetId || !plannedAssetIds.has(observation.assetId)) continue;
    const current = linked.get(observation.assetId) ?? [];
    current.push(observation);
    linked.set(observation.assetId, current);
  }

  const assets = plannedAssets.map<PlannedAssetExecution>((asset) => {
    const assetObservations = linked.get(asset.id) ?? [];
    const lastObservedAt = assetObservations.reduce<string | null>(
      (latest, observation) => latest === null || observation.capturedAt > latest ? observation.capturedAt : latest,
      null,
    );
    return {
      assetId: asset.id,
      status: assetObservations.length > 0 ? 'COVERED' : 'NOT_COVERED',
      observationCount: assetObservations.length,
      lastObservedAt,
    };
  });

  const coveredAssetCount = assets.filter((asset) => asset.status === 'COVERED').length;
  const remainingAssetCount = plannedAssets.length - coveredAssetCount;
  const observationsWithoutPlannedAsset = live.filter(
    (observation) => !observation.assetId || !plannedAssetIds.has(observation.assetId),
  ).length;
  const observationsWithoutRawGps = live.filter(
    (observation) => observation.capturedLocation.locationStatus !== 'CAPTURED',
  ).length;
  const manualLocationAdjustmentCount = live.filter(
    (observation) => observation.locationAdjustment !== null,
  ).length;

  const evidenceCounts: Record<EvidenceMethod, number> = { OBSERVED: 0, MEASURED: 0, REPORTED: 0 };
  for (const observation of live) evidenceCounts[observation.evidence.method] += 1;

  const issues: string[] = [];
  const disclosures: string[] = [];
  let status: CampaignExecutionSummary['checkpoint']['status'];

  if (plannedAssets.length === 0) {
    status = 'NO_PLANNED_ASSETS';
    disclosures.push('This campaign has no planned assets, so planned-asset coverage cannot be assessed.');
  } else {
    if (remainingAssetCount > 0) {
      issues.push(`${remainingAssetCount} planned asset${remainingAssetCount === 1 ? '' : 's'} have no linked observation.`);
    }
    if (observationsWithoutPlannedAsset > 0) {
      issues.push(`${observationsWithoutPlannedAsset} observation${observationsWithoutPlannedAsset === 1 ? '' : 's'} are not linked to a planned campaign asset.`);
    }
    if (observationsWithoutRawGps > 0) {
      issues.push(`${observationsWithoutRawGps} observation${observationsWithoutRawGps === 1 ? '' : 's'} were saved without a captured raw GPS fix.`);
    }
    status = issues.length > 0 ? 'REVIEW_RECOMMENDED' : 'READY_TO_REVIEW';
  }

  if (manualLocationAdjustmentCount > 0) {
    disclosures.push(`${manualLocationAdjustmentCount} observation${manualLocationAdjustmentCount === 1 ? '' : 's'} use a manual location adjustment; raw GPS provenance remains retained.`);
  }
  if (evidenceCounts.REPORTED > 0) {
    disclosures.push(`${evidenceCounts.REPORTED} observation${evidenceCounts.REPORTED === 1 ? '' : 's'} use REPORTED evidence.`);
  }

  return {
    plannedAssetCount: plannedAssets.length,
    coveredAssetCount,
    remainingAssetCount,
    coveragePercent: plannedAssets.length === 0 ? null : Math.round((coveredAssetCount / plannedAssets.length) * 100),
    observationCount: live.length,
    observationsWithoutPlannedAsset,
    observationsWithoutRawGps,
    manualLocationAdjustmentCount,
    evidenceCounts,
    assets,
    checkpoint: { status, issues, disclosures },
  };
}
