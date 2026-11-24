function dataStationTopic(activity) {
  switch (activity.presentation) {
    case 'records': return activity.kind === 'data-correct' ? 'repair' : activity.inputs.every(input => input.entry === 'text') ? 'register' : 'table';
    case 'types': return activity.table[0].includes('Size') ? 'storage' : 'types';
    case 'worksheet': return activity.table[0].includes('Packed') ? 'stock' : 'table';
    case 'files': return 'files';
    case 'order': return 'order';
    case 'survey': return 'decision';
    case 'ballots': return activity.inputs.some(input => input.entry === 'text') ? 'tally' : 'decision';
    default: return activity.table[0][0] === 'Slip' ? 'paper' : 'table';
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = dataStationTopic;
