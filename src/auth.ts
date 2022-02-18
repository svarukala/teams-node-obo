// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as msal from '@azure/msal-node';
import { Console } from 'console';
import { NextFunction, Request, Response } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import jwt_decode from 'jwt-decode';

/**
 * Validates a JWT
 * @param {Request} req - The incoming request
 * @param {Response} res - The outgoing response
 * @returns {Promise<string | null>} - Returns the token if valid, returns null if invalid
 */
export function validateJwt(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization!;
  /*
  const ssoTokenFromAuthHeader = req.headers.authorization!.split(' ')[1];
  console.info(`Token from AuthHeader: ${ssoTokenFromAuthHeader}`);
  console.info(`ClientID from Req: ${req.body.clientid}`);
  const ssoToken = req.query.ssoToken as string;
  console.info(`Toke from query: ${ssoToken}`);
  */
  const ssoToken = authHeader ? authHeader.split(' ')[1] : req.query.ssoToken as string;
  //req.query.ssoToken?.toString() : authHeader.split(' ')[1];
  //console.info(`SSOToken: ${ssoToken}`);
  if (ssoToken) {
    const validationOptions = {
      audience: process.env.AUD // .CLIENT_ID
    };
    jwt.verify(ssoToken, getSigningKey, validationOptions, (err, payload) => {
      if (err) {
        console.info("Error: " + err);
        return res.sendStatus(403);
      }
      next();
    });
  } else {
    res.sendStatus(401);
  }
}

/**
 * Parses the JWT header and retrieves the appropriate public key
 * @param {JwtHeader} header - The JWT header
 * @param {SigningKeyCallback} callback - Callback function
 */
function getSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
  const client = jwksClient({
    jwksUri: 'https://login.microsoftonline.com/common/discovery/keys'
  });
  client.getSigningKey(header.kid!, (err, key) => {
    if (err) {
      callback(err, undefined);
    } else {
      callback(null, key.getPublicKey());
    }
  });
}

/**
 * Gets an access token for the user using the on-behalf-of flow
 * @param authHeader - The Authorization header value containing a JWT bearer token
 * @returns {Promise<string | null>} - Returns the access token if successful, null if not
 */
export async function getAccessTokenOnBehalfOfPost(req: Request, res: Response): Promise<void> {
  console.info("Inside getAccessTokenOnBehalfOfPost. Scopes:"+ req.body.scopes);
  //console.info("Scopes: " + req.body.scopes); 
  // The token has already been validated, just grab it
  const authHeader = req.headers.authorization!;
  const ssoToken = authHeader.split(' ')[1];

  // Create an MSAL client
  const msalClient = new msal.ConfidentialClientApplication({
    auth: {
      clientId: req.body.clientid,
      clientSecret: process.env.APP_SECRET
    }
  });

  try { 
    const result = await msalClient.acquireTokenOnBehalfOf({
      authority: `https://login.microsoftonline.com/${jwt_decode<any>(ssoToken).tid}`,
      oboAssertion: ssoToken,
      scopes: req.body.scopes,
      skipCache: true
    });
    console.info("Access token recvd");// + result?.accessToken);
    res.json({ access_token: result?.accessToken });
  } catch (error: any) {
    if (error.errorCode === 'invalid_grant' || error.errorCode === 'interaction_required') {
      console.info("Error while getting AT1: " + error.message);
      // This is expected if it's the user's first time running the app ( user must consent ) or the admin requires MFA
      res.status(403).json({ error: 'consent_required' }); // This error triggers the consent flow in the client. 
    } else {
      // Unknown error
      console.info("Error while getting AT2: " + error.message);
      res.status(500).json({ error: error.message });
    }
  }
}

/**
 * Gets an access token for the user using the on-behalf-of flow
 * @returns {Promise<string | null>} - Returns the access token if successful, null if not
 */
export async function getAccessTokenOnBehalfOf(req: Request, res: Response): Promise<void> {
  // The token has already been validated.
  const ssoToken: string = req.query.ssoToken!.toString();
  const clientId: string = process.env.CLIENT_ID!.toString(); //req.query.clientId!.toString();
  const graphScopes: string[] = ["https://graph.microsoft.com/.default"];//req.query.scopes!.toString().split(',');

  // Get tenantId from the SSO Token
  const tenantId: string = jwt_decode<any>(ssoToken).tid;
  const clientSecret: string = process.env.APP_SECRET!;

  // Create an MSAL client
  const msalClient = new msal.ConfidentialClientApplication({
    auth: {
      clientId: clientId,
      clientSecret: clientSecret
    }
  });

  try {
    const result = await msalClient.acquireTokenOnBehalfOf({
      authority: `https://login.microsoftonline.com/${tenantId}`,
      oboAssertion: ssoToken,
      scopes: graphScopes,
      skipCache: true
    });
    res.json({ access_token: result?.accessToken });
  } catch (error: any) {
    if (error.errorCode === 'invalid_grant' || error.errorCode === 'interaction_required') {
      // This is expected if it's the user's first time running the app ( user must consent ) or the admin requires MFA
      res.status(403).json({ error: 'consent_required' }); // This error triggers the consent flow in the client.
    } else {
      // Unknown error
      res.status(500).json({ error: error.message });
    }
  }
}
