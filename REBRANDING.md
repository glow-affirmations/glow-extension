# Rebranding a fork

The GPL permits redistribution of the covered code. It does not grant rights to
the Glow Marks or proprietary brand assets.

Before distributing a modified build, replace or remove at least:

- `name`, `displayName`, `publisher`, `author`, repository, support, and website
  metadata in `package.json`;
- user-visible uses of “Glow” and “Glow Affirmations” in commands, views,
  onboarding, account surfaces, documentation, and screenshots;
- every file listed as proprietary in
  [BRAND_ASSET_LICENSE.md](BRAND_ASSET_LICENSE.md);
- Marketplace/Open VSX identities and download links;
- Glow account, checkout, community, and other first-party service endpoints
  unless you have separate permission and a compatible service agreement; and
- any presentation that could make users believe the fork is an official Glow
  release.

Choose new extension, command, view, storage, and URI-scheme identifiers where
leaving the old identifier could cause collisions or imply compatibility. Test
migration behavior before changing persisted identifiers.

You must retain GPL notices, applicable third-party notices, and truthful
copyright attribution. A statement such as “Derived from the Glow Affirmations
project” is allowed when it is factual, secondary, and not used as the fork's
name or endorsement claim.
