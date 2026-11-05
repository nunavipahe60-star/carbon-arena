"use strict";

// Interface demonstration only. Persistent state is returned explicitly.
function decide(snapshot, team, memory) {
  const calls = memory === null ? 0 : memory.calls;
  const own = snapshot.vehicles
    .filter(vehicle => vehicle.team === team)
    .sort((a, b) => a.id - b.id);

  return {
    decision: {
      vehicles: own.map(vehicle => ({
        vehicle: vehicle.id,
        action: "WAIT",
        priority: 0
      })),
      purchases: []
    },
    memory: { calls: calls + 1, lastCompletedTurn: snapshot.turn }
  };
}
