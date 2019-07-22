import {Router} from "express";

import {version} from "package";

import acsConfig from "config/acs_levels";

let userConfig = null;

const USER_CONFIG = process.env.GSA_USER_CONFIG_FILE;

if (USER_CONFIG) {
  console.log("Trying user config file", USER_CONFIG);
  userConfig = require(USER_CONFIG);
  console.log("Using user config file", USER_CONFIG, userConfig);
}
else {
  console.log("Using default configuration:", acsConfig);
}

const levels = userConfig || acsConfig;


const getTableForLevel = (level, mode = "shapes") => `${levels[mode][level].schema}.${levels[mode][level].table}`;

const getMetaForLevel = (level, mode = "shapes") => levels[mode][level];


const defaultLevelLookup = geoId => {
  const prefix = geoId.slice(0, 3);
  const levelMap = {
    "140": "tract",
    "050": "county",
    "040": "state",
    "310": "msa",
    "160": "place",
    "860": "zip",
    "795": "puma",
    "970": "school-district"
  };
  return levelMap[prefix];
};

/*
Given an idMapping dictionary, this function will assemble another function
which given an ID will determine what geospatial level the ID represents
so that the appropriate SQL table can be queried.
*/
function buildLevelLookup(myLevels) {
  if (myLevels.idMapping !== undefined) {
    const myLenConditions = Object.keys(myLevels.idMapping).map(key => {
      return [key, myLevels.idMapping[key].maxLength];
    });
    return lvl => {
      for (let i = 0; i < myLenConditions.length; i++) {
        const item = myLenConditions[i];
        if (lvl.length <= item[1]) {
          return item[0];
        }
      }
      throw new Error("Bad level!");
    };
  }
  return defaultLevelLookup;
}

const levelLookup = buildLevelLookup(levels);

const geoSpatialHelper = (stMode, geoId, skipLevel, overlapSize = false) => {
  const level1 = levelLookup(geoId);
  console.log("MYLEVEL=", level1);
  const targetTable1 = getTableForLevel(level1, "shapes");
  const myMeta1 = getMetaForLevel(level1);
  const targetId1 = myMeta1.id || myMeta1.geoColumn;
  const levelMode = stMode;
  const queries = [];

  if (stMode === "children") {
    stMode = "ST_Contains";
  }
  else if (stMode === "parents") {
    stMode = "ST_Within";
  }
  else {
    stMode = "ST_Intersects";
  }
  const filterCond = lvl => !skipLevel.includes(lvl);
  // Process related shapes
  const lvlsToProcess = Object.keys(levels.shapes).filter(filterCond);
  const geometryColumn1 = "geometry"; ////myMeta1.geometryColumn || "geometry";
  lvlsToProcess.forEach(level => {
    if (level !== level1) {
      const targetTable2 = getTableForLevel(level, "shapes");
      const myMeta = getMetaForLevel(level);
      const nameColumn2 = myMeta.nameColumn || "name";
      const gidColumn2 = myMeta.geoColumn || "geoid";
      const geometryColumn2 = myMeta.geometryColumn || "geometry";

      let qry;
      const specialCase = levels.simpleRelations[level1];
      if (specialCase && specialCase.levels.includes(level) && specialCase.mode === levelMode) {
        // const prefix = reverseLevelLookup(level);
        const testStr = `${geoId.slice(0, specialCase.lengthToRetain)}`;
        qry = {qry: `SELECT s2."${gidColumn2}", s2."${nameColumn2}" as name, '${level}' as level
               FROM ${targetTable2} s2
               WHERE CAST(s2."${gidColumn2}" as TEXT) LIKE $1`,
          params: [`${testStr}%`]};
      }
      else {
        const overlapSizeQry = overlapSize ? ", ST_Area(ST_Intersection(s1.geom, s2.geom)) as overlap_size" : "";

        qry = {qry: `SELECT s2."${gidColumn2}", s2."${nameColumn2}" as name, '${level}' as level ${overlapSizeQry}
               FROM ${targetTable1} s1,
               ${targetTable2} s2
               WHERE ${stMode}(s1."${geometryColumn1}", s2."${geometryColumn2}") AND NOT ST_Touches(s1."${geometryColumn1}", s2."${geometryColumn2}") AND s1.${targetId1} = $1`,
          params: [geoId]};
          
      }

      queries.push(qry);
    }
    
  });

  // Process related points
  if (levels.points) {
    Object.keys(levels.points).forEach(level => {
      if (level !== level1 && filterCond(level)) {
        const targetTable2 = getTableForLevel(level, "points");
        const myMeta = getMetaForLevel(level, "points");
        const nameColumn2 = myMeta.nameColumn || "name";
        const gidColumn2 = myMeta.id || "id";
        const qry = `SELECT s2."${gidColumn2}", s2."${nameColumn2}" as name, '${level}' as level from ${targetTable1} s1,
                  ${targetTable2} s2
                  WHERE ${stMode}(s1.geom, ST_SetSRID(ST_MakePoint(s2."lng", s2.lat), 4269))
                  AND s1.${targetId1} = $1`;
        queries.push({qry, params: [geoId]});
      }
    });
  }
  console.log(queries);
  return queries;
};

const pointFinderHelper = (lng, lat, skipLevel) => {
  const filterCond = lvl => !skipLevel.includes(lvl);
  const queries = [];
  // Process related boundaries
  const lvlsToProcess = Object.keys(levels.shapes).filter(filterCond);
  lvlsToProcess.forEach(level => {
    const targetTable2 = getTableForLevel(level, "shapes");
    const myMeta = getMetaForLevel(level);
    const srid = myMeta.srid || 4269;
    const nameColumn2 = myMeta.nameColumn || "name";
    const gidColumn2 = myMeta.geoColumn || "geoid";
    const qry = `SELECT s2."${gidColumn2}", s2."${nameColumn2}" as name, '${level}' as level
                 FROM ${targetTable2} s2
                 WHERE ST_Intersects(s2.geom, ST_SetSRID(ST_MakePoint($2, $3), $1))`;
    queries.push({qry, params: [srid, parseFloat(lng), parseFloat(lat)]});
  });

  return queries;
};

const getSkipLevels = req => {
  let skipLevel = [...Object.keys(levels.shapes).filter(lvl => getMetaForLevel(lvl).ignoreByDefault),
    ...Object.keys(levels.points).filter(lvl => getMetaForLevel(lvl, "points").ignoreByDefault)];
  let targetLevels = req.query.targetLevels;
  if (targetLevels) {
    targetLevels = targetLevels.split(",");
    const levelNames = [...Object.keys(levels.shapes), ...Object.keys(levels.points)];
    skipLevel = levelNames.filter(x => !targetLevels.includes(x));
  }
  return skipLevel;
};

export default ({db}) => {
  const api = new Router();

  api.get("/", (req, httpResult) => {
    httpResult.json({version});
  });

  api.get("/coordinates", (req, httpResult) => {
    const longitude = req.query.longitude;
    const latitude = req.query.latitude;
    if (!latitude || !longitude) {
      httpResult.status(400).send("Must specify latitude and longitude");
    }
    else {
      const skipLevel = getSkipLevels(req);
      console.log(skipLevel);
      const queries = pointFinderHelper(longitude, latitude, skipLevel);
      Promise.all(queries.map(raw => {
        const {qry, params} = raw;
        return db.query(qry, params);
      }))
        .then(values => values.reduce((acc, x) => [...acc, ...x], []))
        .then(results => httpResult.json(results))
        .catch(error => {
          console.error("An error occured", error);
          httpResult.json({error});
        });
    }
  });

  api.get("/neighbors/:geoId", (req, httpResult) => {
    const geoId = req.params.geoId;
    const level = levelLookup(geoId);
    const myMeta1 = getMetaForLevel(level);
    console.log("MYLEVEL=", level);
    const geoIdColumn1 = myMeta1.geoColumn || "geoid";
    const geometryColumn1 = myMeta1.geometryColumn || "geometry";

    if (!(level in levels.shapes)) {
      httpResult.status(404).json({status: "No such level", level});
    }

    const targetTable = getTableForLevel(level);
    // const myMeta = getMetaForLevel(level);

    const qry = `SELECT s2."${geoIdColumn1}" as geoid, '${level}' as level from ${targetTable} s1,
              ${targetTable} s2
              WHERE ST_Touches(s1."${geometryColumn1}", s2."${geometryColumn1}")
              AND s1."${geoIdColumn1}" = $1;`;
console.log("MYQRY", qry);
    db.query(qry, geoId).then((results, error) => {
      httpResult.json(!error ? results : error);
    });
  });

  api.get("/relations/:mode(parents|children|intersects)/:geoId", (req, httpResult) => {
    const geoId = req.params.geoId;
    const mode = req.params.mode;
    console.log("mode", mode);
    console.log("geoId", geoId);
    console.log("levels", levels);

    let skipLevel = [
      ...Object.keys(levels.shapes).filter(lvl => getMetaForLevel(lvl).ignoreByDefault),
    ];
  
    if (levels.points) {
      skipLevel = [...skipLevel, ...Object.keys(levels.points).filter(lvl => getMetaForLevel(lvl, "points").ignoreByDefault)];
    }

    let targetLevels = req.query.targetLevels;

    if (targetLevels) {
      targetLevels = targetLevels.split(",");
      const levelNames = [...Object.keys(levels.shapes), ...Object.keys(levels.points)];
      skipLevel = levelNames.filter(x => !targetLevels.includes(x));
    }

    const overlapSize = req.query.overlapSize === "true";
    const queries = geoSpatialHelper(mode, geoId, skipLevel, overlapSize);
    Promise.all(queries.map(raw => {
      const {qry, params} = raw;
      return db.query(qry, params);
    }))
      .then(values => values.reduce((acc, x) => [...acc, ...x], []))
      .then(results => httpResult.json(results))
      .catch(error => {
        console.error("An error occured", error);
        httpResult.json({error});
      });
  });

  return api;
};
