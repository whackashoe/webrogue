(function() {
    var Tiles = {
        floor: 0,
        wall: 1,
        lowWall: 2,
        table: 3,
        openDoor: 4,
        closedDoor: 5,
        stairs: 6,
        grass: 7,
        tree: 8,
        treeAlt1: 9,
        treeAlt2: 10
    };

    //https://github.com/munificent/piecemeal/blob/1eec2aa6958b52207bff94722eb594a68f8c6451/lib/src/direction.dart
    var Direction = {
        CARDINAL: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    };

    var stage = {
        width: 100,
        height: 100
    };

    var dungeon = {
        numRoomTries: 0,

        /// The inverse chance of adding a connector between two regions that have
        /// already been joined. Increasing this leads to more loosely connected
        /// dungeons.
        extraConnectorChance: 20,

        /// Increasing this allows rooms to be larger.
        roomExtraSize: 0,

        windingPercent: 0,

        _rooms: [],

        /// For each open position in the dungeon, the index of the connected region
        /// that that position is a part of. 2d array
        _regions: [],

        /// The index of the current region being carved.
        _currentRegion: -1,

        generate: function(stage) {
            if(stage.width % 2 == 0 || stage.height % 2 == 0) {
                throw new ArgumentError("The stage must be odd-sized.");
            }

            bindStage(stage);

            fill(Tiles.wall);
            _regions = new Array2D(stage.width, stage.height);

            _addRooms();

            // Fill in all of the empty space with mazes.
            for (var y = 1; y < bounds.height; y += 2) {
                for (var x = 1; x < bounds.width; x += 2) {
                    var pos = new Vec(x, y);
                    if (getTile(pos) != Tiles.wall) continue;
                    _growMaze(pos);
                }
            }

            _connectRegions();
            _removeDeadEnds();

            _rooms.forEach(onDecorateRoom);
        },

        onDecorateRoom: function(room) {

        },

        /// Implementation of the "growing tree" algorithm from here:
        /// http://www.astrolog.org/labyrnth/algrithm.htm.
        _growMaze: function(start) {
            var cells = [];
            var lastDir;

            _startRegion();
            _carve(start);

            cells.add(start);
            while (cells.isNotEmpty) {
                var cell = cells.last;

                // See which adjacent cells are open.
                var unmadeCells = [];

                for (var dir in Direction.CARDINAL) {
                    if (_canCarve(cell, dir)) unmadeCells.add(dir);
                }

                if (unmadeCells.isNotEmpty) {
                    // Based on how "windy" passages are, try to prefer carving in the
                    // same direction.
                    var dir;
                    if (unmadeCells.contains(lastDir) && rng.range(100) > windingPercent) {
                        dir = lastDir;
                    } else {
                        dir = rng.item(unmadeCells);
                    }

                    _carve(cell + dir);
                    _carve(cell + dir * 2);

                    cells.add(cell + dir * 2);
                    lastDir = dir;
                } else {
                    // No adjacent uncarved cells.
                    cells.removeLast();

                    // This path has ended.
                    lastDir = null;
                }
            }
        },

        /// Places rooms ignoring the existing maze corridors.
        _addRooms: function() {
            for (var i = 0; i < numRoomTries; i++) {
                // Pick a random room size. The funny math here does two things:
                // - It makes sure rooms are odd-sized to line up with maze.
                // - It avoids creating rooms that are too rectangular: too tall and
                //   narrow or too wide and flat.
                // TODO: This isn't very flexible or tunable. Do something better here.
                var size = rng.range(1, 3 + roomExtraSize) * 2 + 1;
                var rectangularity = rng.range(0, 1 + Math.floor(size / 2)) * 2;
                var width = size;
                var height = size;

                if (rng.oneIn(2)) {
                    width += rectangularity;
                } else {
                    height += rectangularity;
                }

                var x = rng.range(Math.floor((bounds.width - width) / 2)) * 2 + 1;
                var y = rng.range(Math.floor((bounds.height - height) / 2)) * 2 + 1;

                var room = new Rect(x, y, width, height);

                var overlaps = false;
                for (var other in _rooms) {
                    if (room.distanceTo(other) <= 0) {
                        overlaps = true;
                        break;
                    }
                }

                if (overlaps) continue;

                _rooms.add(room);

                _startRegion();
                /*
                //TODO
                for (var pos in new Rect(x, y, width, height)) {
                    _carve(pos);
                }
                */
            }
        },

        _connectRegions: function() {
            // Find all of the tiles that can connect two (or more) regions.
            var connectorRegions = {};

            for (var pos in bounds.inflate(-1)) {
                // Can't already be part of a region.
                if (getTile(pos) != Tiles.wall) continue;

                var regions = [];
                for (var dir in Direction.CARDINAL) {
                    var region = _regions[pos + dir];
                    if (region != null) {
                        regions.push(region);
                    }
                }

                if (regions.length < 2) continue;

                connectorRegions[pos] = regions;
            }

            var connectors = connectorRegions.keys.toList();

            // Keep track of which regions have been merged. This maps an original
            // region index to the one it has been merged to.
            var merged = {};
            var openRegions = [];
            for (var i = 0; i <= _currentRegion; i++) {
                merged[i] = i;
                openRegions.push(i);
            }

            // Keep connecting regions until we're down to one.
            while (openRegions.length > 1) {
                var connector = rng.item(connectors);

                // Carve the connection.
                _addJunction(connector);

                // Merge the connected regions. We'll pick one region (arbitrarily) and
                // map all of the other regions to its index.
                var regions = _.map(connectorRegions[connector], function(region) { return merged[region]; });
                var dest = regions.first;
                var sources = regions.skip(1).toList();

                // Merge all of the affected regions. We have to look at *all* of the
                // regions because other regions may have previously been merged with
                // some of the ones we're merging now.
                for (var i = 0; i <= _currentRegion; i++) {
                    if (sources.contains(merged[i])) {
                        merged[i] = dest;
                    }
                }

                // The sources are no longer in use.
                openRegions.removeAll(sources);

                // Remove any connectors that aren't needed anymore.
                connectors.removeWhere(function(pos) {
                    // Don't allow connectors right next to each other.
                    if (connector - pos < 2) {
                        return true;
                    }

                    // If the connector no long spans different regions, we don't need it.
                    var regions = _.map(connectorRegions[pos], function(region){ return merged[region].toSet(); });

                    if (regions.length > 1) {
                        return false;
                    }

                    // This connecter isn't needed, but connect it occasionally so that the
                    // dungeon isn't singly-connected.
                    if (rng.oneIn(extraConnectorChance)) {
                        _addJunction(pos);
                    }

                    return true;
                });
            }
        },

        _addJunction: function(pos) {
            if (rng.oneIn(4)) {
                setTile(pos, rng.oneIn(3) ? Tiles.openDoor : Tiles.floor);
            } else {
                setTile(pos, Tiles.closedDoor);
            }
        },

        _removeDeadEnds: function() {
            var done = false;

            while (!done) {
                done = true;

                for (var pos in bounds.inflate(-1)) {
                    if (getTile(pos) == Tiles.wall) {
                        continue;
                    }

                    // If it only has one exit, it's a dead end.
                    var exits = 0;
                    for (var dir in Direction.CARDINAL) {
                        if (getTile(pos + dir) != Tiles.wall) {
                            exits++;
                        }
                    }

                    if (exits != 1) {
                        continue;
                    }

                    done = false;
                    setTile(pos, Tiles.wall);
                }
            }
        },

        /// Gets whether or not an opening can be carved from the given starting
        /// [Cell] at [pos] to the adjacent Cell facing [direction]. Returns `true`
        /// if the starting Cell is in bounds and the destination Cell is filled
        /// (or out of bounds).</returns>
        _canCarve: function(pos, direction) {
            // Must end in bounds.
            if (!bounds.contains(pos + direction * 3)) {
                return false;
            }

            // Destination must not be open.
            return getTile(pos + direction * 2) == Tiles.wall;
        },

        _startRegion: function() {
            _currentRegion++;
        },

        _carve: function(pos, tile_type) {
            if (tile_type == null) {
                tile_type = Tiles.floor;
            }

            setTile(pos, tile_type);
            _regions[pos] = _currentRegion;
        }
    };
    console.log("ok");
})();