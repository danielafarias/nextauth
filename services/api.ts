import axios, { AxiosError } from "axios";
import { GetServerSidePropsContext } from "next";
import { parseCookies, setCookie } from "nookies";
import { signOut } from "../contexts/AuthContext";

type FailedRequestQueue = {
  resolve: (token: string) => void;
  reject: (err: AxiosError) => void;
};

interface AxiosErrorResponse {
  code?: string;
}

type Context = undefined | GetServerSidePropsContext;

let failedRequestQueue = [] as FailedRequestQueue[];
let isRefreshing = false;

export function setupAPIClient(ctx: Context = undefined) {
    let cookies = parseCookies(ctx);

    const api = axios.create({
        baseURL: "http://localhost:3333",
      });
      
      api.defaults.headers.common['Authorization'] = `Bearer ${cookies['nextauth.token']}`;
      
      api.interceptors.response.use(
        (response) => {
          return response;
        },
        (error: AxiosError<AxiosErrorResponse>) => {
          if (error.response.status === 401) {
            if (error.response.data?.code === "token.expired") {
              cookies = parseCookies(ctx);
      
              const { "nextauth.refreshToken": refreshToken } = cookies;
              const originalConfig = error.config;
      
              if (!isRefreshing) {
                isRefreshing = true;
      
                api
                  .post("/refresh", { refreshToken })
                  .then((response) => {
                    const { token } = response.data;
      
                    setCookie(ctx, "nextauth.token", token, {
                      maxAge: 60 * 60 * 24 * 30, // 30 days
                      path: "/",
                    });
      
                    setCookie(
                      ctx,
                      "nextauth.refreshToken",
                      response.data.refreshToken,
                      {
                        maxAge: 60 * 60 * 24 * 30, // 30 days
                        path: "/",
                      }
                    );
      
                    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      
                    failedRequestQueue.forEach((request) => request.resolve(token));
                    failedRequestQueue = [];
                  })
                  .catch((err) => {
                    failedRequestQueue.forEach((request) => request.reject(err));
                    failedRequestQueue = [];
      
                    if (process.browser) {
                      signOut();
                    }
                  })
                  .finally(() => {
                    isRefreshing = false;
                  });
              }
      
              return new Promise((resolve, reject) => {
                failedRequestQueue.push({
                  resolve: (token: string) => {
                    if (!originalConfig?.headers) {
                      return;
                    }
      
                    originalConfig.headers["Authorization"] = `Bearer ${token}`;
      
                    resolve(api(originalConfig));
                  },
                  reject: (err: AxiosError) => {
                    reject(err);
                  },
                });
              });
            } else {
              if (process.browser) {
                  signOut();
                }
            }
          }
      
          return Promise.reject(error);
        }
      );

      return api;
}