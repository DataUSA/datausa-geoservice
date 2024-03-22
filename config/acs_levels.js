export const levels = {
  shapes: {
    state: {schema: "shapes2017", table: "states", id: "geoid", parent: "state", columns: ["name", "geoid"], srid: 4269},
    county: {schema: "shapes2017", table: "counties", id: "geoid", parent: "state", columns: ["name", "geoid"], nameColumn: "namelsad", srid: 4269},
    place: {schema: "shapes2017", table: "places", id: "geoid", parent: "county", columns: ["name", "geoid"], srid: 4269},
    tract: {schema: "shapes2017", table: "tracts", id: "geoid", parent: "county", columns: ["name", "geoid"], nameColumn: "namelsad", srid: 4269, ignoreByDefault: true},
    msa: {schema: "shapes2017", table: "msas", id: "geoid", parent: "state", columns: ["name", "geoid"], srid: 4269},
    puma: {schema: "shapes2023", table: "pumas", id: "geoid", parent: "state", columns: ["name", "geoid"], srid: 4269, ignoreByDefault: true},
    congressionaldistrict: {schema: "shapes2018", table: "congressionaldistrict", id: "geoid", parent: "state", columns: ["name", "geoid"], srid: 4269},
    faf_region: {schema: "shapes2017", table: "faf_regions", id: "geoid", nameColumn: "cfs12_name", parent: "state", columns: ["cfs12_name", "geoid"], srid: 4269, ignoreByDefault: true}
  },
  points: {
    university: {
      schema: "ipeds_geo",
      table: "university_geom",
      id: "university",
      longitude: "lng",
      latitude: "lat",
      nameColumn: "university_name",
      ignoreByDefault: true
    }
  },
  simpleRelations: {
    state: {
      lengthToRetain: 9,
      levels: ["county", "tract", "puma"],
      mode: "children"
    },
    county: {
      lengthToRetain: 12,
      levels: ["tract"],
      mode: "children"
    }
  }
};
