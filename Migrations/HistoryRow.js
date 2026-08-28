// Ported from Entity Framework Core (dotnet/efcore, MIT) — Migrations/HistoryRow.cs.
// See THIRD-PARTY-NOTICES.md.

/**
 * An entity type that represents a row in the Migrations history table.
 *
 * EF stores (MigrationId, ProductVersion). masterrecord's history table has
 * carried (migration_name, applied_at) since the tracking table was introduced,
 * so a row also exposes `appliedAt`; `productVersion` is null for rows written
 * by versions that predate it.
 */
class HistoryRow {
    /**
     * @param {string} migrationId - The migration identifier.
     * @param {string|null} [productVersion] - The masterrecord version that applied it.
     * @param {string|null} [appliedAt] - ISO timestamp the migration was applied.
     */
    constructor(migrationId, productVersion = null, appliedAt = null) {
        this.migrationId = migrationId;
        this.productVersion = productVersion;
        this.appliedAt = appliedAt;
    }
}

export default HistoryRow;
export { HistoryRow };
