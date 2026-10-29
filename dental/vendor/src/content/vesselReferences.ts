/** Sources for the existing vessel-course descriptions, shared by translations. */
const source = (title: string, url: string) => ({ title, url });
const maxillary = source('StatPearls: Maxillary Artery', 'https://www.ncbi.nlm.nih.gov/sites/books/NBK542301/');
const plexus = source('StatPearls: Pterygoid Plexus', 'https://www.ncbi.nlm.nih.gov/sites/books/NBK555896/');
export const VESSEL_REFERENCES = {
  'external-carotid-artery': source('StatPearls: Carotid Arteries', 'https://www.ncbi.nlm.nih.gov/books/NBK545238/'),
  'maxillary-artery': maxillary,
  'inferior-alveolar-artery': maxillary,
  'posterior-superior-alveolar-artery': maxillary,
  'descending-palatine-artery': maxillary,
  'buccal-artery': maxillary,
  'facial-artery': source('StatPearls: Facial Artery', 'https://www.ncbi.nlm.nih.gov/books/NBK536932/'),
  'inferior-alveolar-vein': plexus,
  'pterygoid-plexus': plexus,
  'maxillary-vein': plexus,
  'retromandibular-vein': plexus,
  'facial-vein': source('StatPearls: Internal Jugular Vein', 'https://www.ncbi.nlm.nih.gov/books/NBK513258/'),
  'internal-jugular-vein': source('StatPearls: Internal Jugular Vein', 'https://www.ncbi.nlm.nih.gov/books/NBK513258/'),
};
