import { Router, Request, Response } from 'express';
import { resolveAndTrack } from '../services/qr-service.js';

const router = Router();

router.get('/:shortId', async (req: Request, res: Response) => {
  try {
    const target = await resolveAndTrack(req.params.shortId, req);
    if (!target) {
      return res.status(404).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:80px 20px">
          <h2>QR Code not found or inactive</h2>
          <p>The QR code you scanned is invalid or has been deactivated.</p>
        </body></html>
      `);
    }
    res.redirect(301, target);
  } catch {
    res.status(500).send('Server error');
  }
});

export default router;
